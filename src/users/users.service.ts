import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { MonitoringService } from '../monitoring/monitoring.service';
import { AuthService } from '../auth/auth.service';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';

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

  async changeTeam(userId: string, teamId: string | null) {
    if (teamId) {
      const team = await this.prisma.team.findUnique({ where: { id: teamId } });
      if (!team) throw new BadRequestException('Équipe inexistante');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    if (user.teamId === teamId) return { id: user.id, teamId: user.teamId };
    const fromTeamId = user?.teamId ?? null;

    const updated = await this.prisma.$transaction(async (tx) => {
      const changedUser = await tx.user.update({
        where: { id: userId },
        data: { teamId },
        select: { id: true, teamId: true },
      });
      if (teamId) {
        await tx.teamChangeLog.create({
          data: { userId, fromTeamId, toTeamId: teamId },
        });
      }
      return changedUser;
    });

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
    const experiencePoints = attempts.reduce(
      (sum: number, attempt: any) => sum + 10 + Math.floor(attempt.score / 10),
      0,
    );
    const levelSize = 250;
    const levelProgress = experiencePoints % levelSize;
    const perfectChallenges = attempts.filter((attempt: any) => attempt.score === 100).length;
    const badges = [
      { id: 'first-challenge', title: 'Premier pas', description: 'Terminer un défi', unlocked: attempts.length >= 1 },
      { id: 'five-challenges', title: 'Curieux', description: 'Terminer 5 défis', unlocked: attempts.length >= 5 },
      { id: 'twenty-challenges', title: 'Persévérant', description: 'Terminer 20 défis', unlocked: attempts.length >= 20 },
      { id: 'perfect-score', title: 'Sans faute', description: 'Obtenir un score de 100', unlocked: perfectChallenges > 0 },
    ];

const avgScore = attempts.length 
  ? attempts.reduce((sum: number, a: any) => sum + a.score, 0) / attempts.length 
  : 0;

    return {
      challengesCompleted: attempts.length,
      totalEnergyContributed: totalEnergy,
      experiencePoints,
      level: Math.floor(experiencePoints / levelSize) + 1,
      levelProgress,
      levelSize,
      badges,
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
    if (userId === adminId) {
      throw new BadRequestException('Tu ne peux pas te bloquer toi-même');
    }
    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (target?.role === 'ADMIN') {
      throw new ForbiddenException('Un admin ne peut pas bloquer un autre admin');
    }

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
    async setAvatar(userId: string, emoji: string, color: string) {
    const avatar = JSON.stringify({ emoji, color });
    return this.prisma.user.update({ where: { id: userId }, data: { avatar }, select: { avatar: true } });
  }
     async getDirectory(excludeUserId: string) {
    return this.prisma.user.findMany({
      where: { id: { not: excludeUserId }, status: 'ACTIVE' },
      select: { id: true, pseudo: true, teamId: true },
      orderBy: { pseudo: 'asc' },
      take: 100,
    });
  }

  // Classement individuel basé sur l'énergie totale apportée aux défis quotidiens
  async getLeaderboard() {
    const grouped = await this.prisma.dailyChallengeAttempt.groupBy({
      by: ['userId'],
      where: { energyEarned: { gt: 0 } },
      _sum: { energyEarned: true },
      _count: { _all: true },
      orderBy: { _sum: { energyEarned: 'desc' } },
      take: 20,
    });

    if (grouped.length === 0) return [];

    const userIds = grouped.map((g) => g.userId);
    const [users, duelWins] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: userIds }, status: 'ACTIVE' },
        select: { id: true, pseudo: true, avatar: true, team: { select: { name: true, color: true } } },
      }),
      this.prisma.duel.groupBy({
        by: ['winnerId'],
        where: { winnerId: { in: userIds } },
        _count: { _all: true },
      }),
    ]);

    const duelWinsByUser = new Map(duelWins.map((d) => [d.winnerId, d._count._all]));
    const usersById = new Map(users.map((u) => [u.id, u]));

    return grouped
      .filter((g) => usersById.has(g.userId)) // exclut les comptes bloqués depuis, sans casser le classement
      .map((g) => {
        const user = usersById.get(g.userId)!;
        return {
          userId: user.id,
          pseudo: user.pseudo,
          avatar: user.avatar,
          team: user.team,
          totalEnergyContributed: g._sum.energyEarned ?? 0,
          challengesCompleted: g._count._all,
          duelsWon: duelWinsByUser.get(g.userId) ?? 0,
        };
      });
  }
}
