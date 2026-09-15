import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TeamsService {
  constructor(private readonly prisma: PrismaService) {}

  async listWithStats() {
    const teams = await this.prisma.team.findMany({
      include: {
        _count: { select: { members: true, territories: true } },
      },
      orderBy: { energy: 'desc' },
    });
    return teams;
  }

  async getDetails(id: string) {
    return this.prisma.team.findUnique({
      where: { id },
      include: {
        territories: true,
        members: { select: { id: true, pseudo: true, avatar: true } },
      },
    });
  }

  // Ajoute de l'énergie à une équipe (appelé par ChallengesService) et retourne le nouveau total
  async addEnergy(teamId: string, amount: number) {
    return this.prisma.team.update({
      where: { id: teamId },
      data: { energy: { increment: amount } },
    });
  }

  async resetEnergy(teamId: string) {
    return this.prisma.team.update({ where: { id: teamId }, data: { energy: 0 } });
  }
}
