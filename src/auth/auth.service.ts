import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomUUID, randomBytes, createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MonitoringService } from '../monitoring/monitoring.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 15;
const BCRYPT_ROUNDS = 12;
const RESET_TOKEN_EXPIRATION_MINUTES = 15;
const REFRESH_TOKEN_RETRY_GRACE_MS = 30_000;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly monitoring: MonitoringService,
  ) {}

  async register(dto: RegisterDto, ip: string, userAgent?: string) {
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email: dto.email }, { pseudo: dto.pseudo }] },
    });
    if (existing) throw new ConflictException('Email ou pseudo déjà utilisé');

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = await this.prisma.user.create({
      data: { email: dto.email, pseudo: dto.pseudo, passwordHash },
    });

    await this.monitoring.logAndBroadcast('REGISTER', user.id, { ip });
    return this.issueTokens(user.id, user.email, user.role, ip, userAgent);
  }

  async login(dto: LoginDto, ip: string, userAgent?: string) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });

    // Message volontairement générique pour ne pas révéler si l'email existe (énumération)
    const genericError = new UnauthorizedException('Identifiants invalides');
    if (!user) throw genericError;

    if (user.status === 'BLOCKED') throw new ForbiddenException('Compte bloqué');

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ForbiddenException(
        `Compte temporairement verrouillé suite à plusieurs échecs. Réessaie plus tard.`,
      );
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      await this.registerFailedAttempt(user.id, user.failedLoginAttempts, ip);
      throw genericError;
    }

    // Connexion réussie → reset du compteur d'échecs
    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    await this.monitoring.logAndBroadcast('LOGIN', user.id, { ip });
    return this.issueTokens(user.id, user.email, user.role, ip, userAgent);
  }

  private async registerFailedAttempt(userId: string, currentAttempts: number, ip: string) {
    const attempts = currentAttempts + 1;
    const shouldLock = attempts >= MAX_FAILED_ATTEMPTS;

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginAttempts: attempts,
        lockedUntil: shouldLock
          ? new Date(Date.now() + LOCK_DURATION_MINUTES * 60 * 1000)
          : null,
      },
    });

    await this.monitoring.logAndBroadcast(
      shouldLock ? 'ACCOUNT_LOCKED' : 'LOGIN_FAILED',
      userId,
      { ip, attempts },
    );
  }

  // Génère access token (courte durée) + refresh token persisté en DB (remember me)
  private async issueTokens(
    userId: string,
    email: string,
    role: string,
    ip: string,
    userAgent?: string,
    tokenFamily?: string,
    previousSessionId?: string,
  ) {
    const accessToken = this.jwt.sign(
      { sub: userId, email, role },
      {
        secret: this.config.get('JWT_ACCESS_SECRET'),
        expiresIn: this.config.get('JWT_ACCESS_EXPIRATION'),
      },
    );

    const refreshToken = this.jwt.sign(
      { sub: userId, jti: randomUUID() },
      {
        secret: this.config.get('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get('JWT_REFRESH_EXPIRATION'),
      },
    );

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // aligné sur JWT_REFRESH_EXPIRATION

    const session = await this.prisma.session.create({
      data: {
        userId,
        refreshToken,
        tokenFamily: tokenFamily ?? randomUUID(),
        expiresAt,
        ipAddress: ip,
        userAgent,
      },
    });

    if (previousSessionId) {
      await this.prisma.session.update({
        where: { id: previousSessionId },
        data: { revokedAt: new Date(), replacedBy: session.id },
      });
    }

    return { accessToken, refreshToken };
  }

  // Appelé quand le cookie refresh token est présent (remember me) pour renouveler l'access token
  // Rotation à chaque appel : l'ancien token est révoqué et remplacé par un nouveau
  async refresh(refreshToken: string, ip: string, userAgent?: string) {
    if (!refreshToken) throw new UnauthorizedException('Session absente');

    const session = await this.prisma.session.findUnique({ where: { refreshToken } });
    if (!session) throw new UnauthorizedException('Session invalide');

    // Détection de rejeu : un token déjà révoqué qui est réutilisé = vol probable
    // → on invalide toute la lignée de tokens (tokenFamily) par précaution
    if (session.revokedAt) {
      const retryWithinGrace =
        Date.now() - session.revokedAt.getTime() <= REFRESH_TOKEN_RETRY_GRACE_MS &&
        Boolean(session.replacedBy) &&
        Boolean(session.userAgent) &&
        session.userAgent === userAgent;

      if (retryWithinGrace) {
        const [replacement, user] = await Promise.all([
          this.prisma.session.findFirst({
            where: {
              tokenFamily: session.tokenFamily,
              revokedAt: null,
              expiresAt: { gt: new Date() },
            },
            orderBy: { createdAt: 'desc' },
          }),
          this.prisma.user.findUnique({ where: { id: session.userId } }),
        ]);

        if (replacement && user && user.status !== 'BLOCKED') {
          const accessToken = this.jwt.sign(
            { sub: user.id, email: user.email, role: user.role },
            {
              secret: this.config.get('JWT_ACCESS_SECRET'),
              expiresIn: this.config.get('JWT_ACCESS_EXPIRATION'),
            },
          );
          return { accessToken, refreshToken: replacement.refreshToken };
        }
      }

      await this.prisma.session.updateMany({
        where: { tokenFamily: session.tokenFamily, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.monitoring.logAndBroadcast('TOKEN_REUSE_DETECTED', session.userId, { ip });
      throw new UnauthorizedException('Session compromise détectée, reconnexion nécessaire');
    }

    if (session.expiresAt < new Date()) {
      throw new UnauthorizedException('Session expirée, reconnexion nécessaire');
    }

    const user = await this.prisma.user.findUnique({ where: { id: session.userId } });
    if (!user || user.status === 'BLOCKED') throw new UnauthorizedException();

    const { accessToken, refreshToken: newRefreshToken } = await this.issueTokens(
      user.id,
      user.email,
      user.role,
      ip,
      userAgent,
      session.tokenFamily,
      session.id,
    );

    return { accessToken, refreshToken: newRefreshToken };
  }

  async logout(refreshToken: string) {
    if (!refreshToken) return;
    await this.prisma.session.updateMany({
      where: { refreshToken },
      data: { revokedAt: new Date() },
    });
  }

  // Révoque toutes les sessions d'un utilisateur (ex: après blocage admin, réinitialisation de mot de passe)
  async revokeAllSessions(userId: string) {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // --- Réinitialisation de mot de passe par phrase secrète ---

  // Étape unique de vérification (email + phrase secrète ensemble) — jamais de confirmation
  // séparée sur l'existence de l'email, pour ne rien laisser deviner à un collègue.
  async verifySecretPhraseAndIssueResetToken(email: string, secretPhrase: string, ip: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    const genericError = new UnauthorizedException('Email ou phrase secrète incorrects');

    if (!user || !user.secretPhraseHash) {
      // Compte inexistant OU phrase jamais configurée — même erreur dans les deux cas
      throw genericError;
    }

    if (user.status === 'BLOCKED') throw new ForbiddenException('Compte bloqué');

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ForbiddenException(
        'Compte temporairement verrouillé suite à plusieurs échecs. Réessaie plus tard.',
      );
    }

    const valid = await bcrypt.compare(secretPhrase, user.secretPhraseHash);
    if (!valid) {
      // Même compteur de verrouillage que le login — une seule ressource à protéger par compte
      await this.registerFailedAttempt(user.id, user.failedLoginAttempts, ip);
      throw genericError;
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });

    // Token à usage unique — seul le hash SHA-256 est persisté, jamais le token brut
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRATION_MINUTES * 60 * 1000);

    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });

    await this.monitoring.logAndBroadcast('PASSWORD_RESET', user.id, { ip, step: 'token_issued' });

    return { resetToken: rawToken, expiresInMinutes: RESET_TOKEN_EXPIRATION_MINUTES };
  }

  async confirmPasswordReset(token: string, newPassword: string, ip: string) {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const resetToken = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash } });

    const genericError = new UnauthorizedException('Lien de réinitialisation invalide ou expiré');
    if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
      throw genericError;
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: resetToken.userId }, data: { passwordHash } }),
      this.prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      }),
    ]);

    // Coupe toutes les sessions actives — si le compte a été compromis, on ferme tout
    await this.revokeAllSessions(resetToken.userId);

    await this.monitoring.logAndBroadcast('PASSWORD_RESET', resetToken.userId, {
      ip,
      step: 'completed',
    });

    return { success: true };
  }
}