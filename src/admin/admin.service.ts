import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async getGlobalStats() {
    const [totalUsers, activeUsers, blockedUsers, totalTeams, totalTerritories, totalRaids, totalDuels, challengesToday] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.user.count({ where: { status: 'ACTIVE' } }),
        this.prisma.user.count({ where: { status: 'BLOCKED' } }),
        this.prisma.team.count(),
        this.prisma.territory.count(),
        this.prisma.raid.count(),
        this.prisma.duel.count(),
        this.prisma.dailyChallengeAttempt.count({
          where: { completedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
        }),
      ]);

    const teamRanking = await this.prisma.team.findMany({
      orderBy: { energy: 'desc' },
      select: { id: true, name: true, energy: true, _count: { select: { territories: true } } },
    });

    return {
      totalUsers, activeUsers, blockedUsers,
      totalTeams, totalTerritories, totalRaids, totalDuels,
      challengesCompletedToday: challengesToday,
      teamRanking,
    };
  }

  async getRecentActivity(limit = 50) {
    return this.prisma.activityLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200), // borne dure pour éviter une requête abusive
      include: { user: { select: { pseudo: true, email: true } } },
    });
  }

  async getRaidsOverview() {
    return this.prisma.raid.findMany({
      orderBy: { triggeredAt: 'desc' },
      take: 50,
      include: { attackerTeam: true, defenderTeam: true, territory: true },
    });
  }
}
