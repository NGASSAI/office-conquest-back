import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MonitoringService } from '../monitoring/monitoring.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 15;
const BCRYPT_ROUNDS = 12;

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

  // Révoque toutes les sessions d'un utilisateur (ex: après blocage admin, ou changement de mot de passe)
  async revokeAllSessions(userId: string) {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
