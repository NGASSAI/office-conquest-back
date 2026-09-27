import { PrismaService } from '../prisma/prisma.service';
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { MonitoringService } from '../monitoring/monitoring.service';
import { AuthService } from '../auth/auth.service';
import { ListUsersQueryDto } from './dto/list-users-query.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly monitoring: MonitoringService,
    private readonly authService: AuthService,
  ) {}

   async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, pseudo: true, avatar: true, role: true,
        status: true, teamId: true, team: true, createdAt: true, lastLoginAt: true,
        secretPhraseHash: true,
        // passwordHash volontairement exclu
      },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable');

    // On ne renvoie jamais le hash lui-même au client — juste s'il existe
    const { secretPhraseHash, ...rest } = user;
    return { ...rest, hasSecretPhrase: !!secretPhraseHash };
  }

  async changeTeam(userId: string, teamId: string) {
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new BadRequestException('Équipe inexistante');

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const fromTeamId = user?.teamId ?? null;

    const [updated] = await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { teamId } }),
      this.prisma.teamChangeLog.create({
        data: { userId, fromTeamId, toTeamId: teamId },
      }),
    ]);

    await this.monitoring.logAndBroadcast('TEAM_CHANGE', userId, { fromTeamId, toTeamId: teamId });
    return updated;
  }

  async getPerformance(userId: string) {
    const [attempts, raids, duelsWon] = await Promise.all([
      this.prisma.dailyChallengeAttempt.findMany({ where: { userId } }),
      this.prisma.raidParticipant.findMany({ where: { userId }, include: { raid: true } }),
      this.prisma.duel.count({ where: { winnerId: userId } }),
    ]);

   const totalEnergy = attempts.reduce((sum: number, a: any) => sum + a.energyEarned, 0);

const avgScore = attempts.length 
  ? attempts.reduce((sum: number, a: any) => sum + a.score, 0) / attempts.length 
  : 0;

    return {
      challengesCompleted: attempts.length,
      totalEnergyContributed: totalEnergy,
      averageScore: Math.round(avgScore * 100) / 100,
      raidsParticipated: raids.length,
      duelsWon,
    };
  }

  async listUsers(query: ListUsersQueryDto) {
    const { search, status, page = 1, pageSize = 20 } = query;
    const where = {
      ...(status && { status }),
      ...(search && {
        OR: [
          { email: { contains: search, mode: 'insensitive' as const } },
          { pseudo: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: {
          id: true, email: true, pseudo: true, role: true, status: true,
          teamId: true, createdAt: true, lastLoginAt: true, failedLoginAttempts: true,
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return { users, total, page, pageSize };
  }

  async setStatus(userId: string, status: 'ACTIVE' | 'BLOCKED', adminId: string) {
    const user = await this.prisma.user.update({ where: { id: userId }, data: { status } });

    // Si on bloque un utilisateur, on révoque immédiatement toutes ses sessions actives
    if (status === 'BLOCKED') {
      await this.authService.revokeAllSessions(userId);
    }

    await this.monitoring.logAndBroadcast(
      status === 'BLOCKED' ? 'USER_BLOCKED' : 'USER_UNBLOCKED',
      adminId,
      { targetUserId: userId },
    );
    return user;
  }
    // Phrase secrète — configurée dans le profil, sert uniquement à la réinitialisation de mot de passe
  async setSecretPhrase(userId: string, secretPhrase: string) {
    const secretPhraseHash = await bcrypt.hash(secretPhrase, 12);
    await this.prisma.user.update({ where: { id: userId }, data: { secretPhraseHash } });
    await this.monitoring.logAndBroadcast('SECRET_PHRASE_SET', userId, {});
    return { success: true };
  }
}
