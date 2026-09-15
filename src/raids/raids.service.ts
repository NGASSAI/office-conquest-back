import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MonitoringService } from '../monitoring/monitoring.service';

const ROUND_TYPES = ['QUIZ', 'REFLEX', 'MEMORY'] as const;

@Injectable()
export class RaidsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly monitoring: MonitoringService,
  ) {}

  // Appelé après chaque défi quotidien complété — déclenche un raid si le seuil d'énergie est atteint
  async checkAndTriggerRaid(attackerTeamId: string) {
    const attackerTeam = await this.prisma.team.findUnique({ where: { id: attackerTeamId } });
    if (!attackerTeam || attackerTeam.energy < attackerTeam.energyThreshold) return null;

    // Cible : un territoire qui n'appartient pas déjà à l'équipe attaquante
    const target = await this.prisma.territory.findFirst({
      where: { ownerTeamId: { not: attackerTeamId } },
      orderBy: { capturedAt: 'asc' }, // priorité aux territoires détenus depuis le plus longtemps
    });
    if (!target || !target.ownerTeamId) return null;

    // Évite les doublons : pas de nouveau raid si un raid est déjà en cours sur ce territoire
    const ongoing = await this.prisma.raid.findFirst({
      where: { territoryId: target.id, status: { in: ['PENDING', 'IN_PROGRESS'] } },
    });
    if (ongoing) return null;

    const raid = await this.prisma.raid.create({
      data: {
        attackerTeamId,
        defenderTeamId: target.ownerTeamId,
        territoryId: target.id,
        status: 'PENDING',
      },
    });

    // Consomme l'énergie utilisée pour déclencher le raid
    await this.prisma.team.update({
      where: { id: attackerTeamId },
      data: { energy: { decrement: attackerTeam.energyThreshold } },
    });

    await this.monitoring.logAndBroadcast('RAID_TRIGGERED', null, {
      raidId: raid.id, attackerTeamId, defenderTeamId: target.ownerTeamId, territoryId: target.id,
    });

    return raid;
  }

  async getActiveRaidsForUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.teamId) return [];
    return this.getActiveRaidsForTeam(user.teamId);
  }

  async getActiveRaidsForTeam(teamId: string) {
    return this.prisma.raid.findMany({
      where: {
        status: { in: ['PENDING', 'IN_PROGRESS'] },
        OR: [{ attackerTeamId: teamId }, { defenderTeamId: teamId }],
      },
      include: { territory: true, attackerTeam: true, defenderTeam: true },
    });
  }

  // Un membre d'une des deux équipes rejoint le raid
  async joinRaid(raidId: string, userId: string) {
    const raid = await this.prisma.raid.findUnique({ where: { id: raidId } });
    if (!raid) throw new NotFoundException('Raid introuvable');

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.teamId || ![raid.attackerTeamId, raid.defenderTeamId].includes(user.teamId)) {
      throw new ForbiddenException("Tu ne fais pas partie d'une équipe impliquée dans ce raid");
    }

    if (raid.status === 'COMPLETED' || raid.status === 'CANCELLED') {
      throw new BadRequestException('Ce raid est terminé');
    }

    await this.prisma.raidParticipant.upsert({
      where: { raidId_userId: { raidId, userId } },
      create: { raidId, userId, teamId: user.teamId },
      update: {},
    });

    if (raid.status === 'PENDING') {
      await this.prisma.raid.update({
        where: { id: raidId },
        data: { status: 'IN_PROGRESS', startedAt: new Date() },
      });
      await this.startRound(raidId, 1);
    }

    return this.prisma.raid.findUnique({
      where: { id: raidId },
      include: { participants: true, rounds: true },
    });
  }

  private async startRound(raidId: string, roundNumber: number) {
    const type = ROUND_TYPES[(roundNumber - 1) % ROUND_TYPES.length];
    return this.prisma.raidRound.create({
      data: { raidId, roundNumber, type, resultsData: {} },
    });
  }

  // Enregistre le score d'un joueur pour la manche en cours (validé côté serveur, borné par le DTO)
  async submitRoundScore(raidId: string, roundId: string, userId: string, score: number) {
    const round = await this.prisma.raidRound.findUnique({ where: { id: roundId } });
    if (!round || round.raidId !== raidId) throw new NotFoundException('Manche introuvable');
    if (round.endedAt) throw new BadRequestException('Manche déjà terminée');

    const resultsData = (round.resultsData as Record<string, number>) ?? {};
    resultsData[userId] = score;

    await this.prisma.raidRound.update({
      where: { id: roundId },
      data: { resultsData },
    });

    await this.prisma.raidParticipant.updateMany({
      where: { raidId, userId },
      data: { totalScore: { increment: score } },
    });

    return resultsData;
  }

  // Clôture une manche ; si c'était la 3e, calcule le résultat final du raid
  async endRound(raidId: string, roundId: string) {
    await this.prisma.raidRound.update({ where: { id: roundId }, data: { endedAt: new Date() } });

    const round = await this.prisma.raidRound.findUnique({ where: { id: roundId } });
    if (round && round.roundNumber < 3) {
      return this.startRound(raidId, round.roundNumber + 1);
    }
    return this.finalizeRaid(raidId);
  }

  private async finalizeRaid(raidId: string) {
    const raid = await this.prisma.raid.findUnique({
      where: { id: raidId },
      include: { participants: true },
    });
    if (!raid) return null;

    const attackerScore = raid.participants
      .filter((p: { teamId: string; totalScore: number }) => p.teamId === raid.attackerTeamId)
      .reduce((s: number, p: { totalScore: number }) => s + p.totalScore, 0);

    const defenderScore = raid.participants
      .filter((p: { teamId: string; totalScore: number }) => p.teamId === raid.defenderTeamId)
      .reduce((s: number, p: { totalScore: number }) => s + p.totalScore, 0);

    const result =
      attackerScore > defenderScore ? 'ATTACKER_WIN' : attackerScore < defenderScore ? 'DEFENDER_WIN' : 'DRAW';

    await this.prisma.raid.update({
      where: { id: raidId },
      data: { status: 'COMPLETED', result, endedAt: new Date() },
    });

    if (result === 'ATTACKER_WIN') {
      await this.prisma.territory.update({
        where: { id: raid.territoryId },
        data: { ownerTeamId: raid.attackerTeamId, capturedAt: new Date() },
      });
    }

    await this.monitoring.logAndBroadcast('RAID_RESULT', null, {
      raidId, result, attackerScore, defenderScore,
    });

    return { result, attackerScore, defenderScore };
  }
}