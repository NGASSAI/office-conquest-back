import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MonitoringService } from '../monitoring/monitoring.service';
import { NotificationsService } from '../notifications/notifications.service';

const ROUND_TYPES = ['QUIZ', 'REFLEX', 'MEMORY'] as const;
const MEMORY_SEQUENCE_LENGTH = 5;
const MEMORY_COLORS = ['red', 'blue', 'green', 'yellow'] as const;
const PENDING_RAID_TIMEOUT_MS = 24 * 60 * 60 * 1000;

// Banque de questions — stockée côté serveur uniquement, jamais envoyée avec la réponse au client
const QUIZ_BANK = [
  { question: 'Combien de territoires compte la carte du bureau ?', options: ['3', '5', '8', '10'], correctAnswer: '5' },
  { question: 'Quel est le seuil d\'énergie par défaut pour déclencher un raid ?', options: ['500', '1000', '2000', '5000'], correctAnswer: '1000' },
  { question: 'Combien de manches compte un raid ?', options: ['1', '2', '3', '5'], correctAnswer: '3' },
];

@Injectable()
export class RaidsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly monitoring: MonitoringService,
    private readonly notifications: NotificationsService,
  ) {}

  private async expireStalePendingRaids() {
    const staleBefore = new Date(Date.now() - PENDING_RAID_TIMEOUT_MS);
    const pendingRaids = await this.prisma.raid.findMany({
      where: { status: 'PENDING', triggeredAt: { lt: staleBefore } },
      select: { id: true, attackerTeamId: true, defenderTeamId: true, energyCost: true },
    });

    for (const raid of pendingRaids) {
      const expired = await this.prisma.$transaction(async (tx) => {
        const result = await tx.raid.updateMany({
          where: { id: raid.id, status: 'PENDING', triggeredAt: { lt: staleBefore } },
          data: { status: 'CANCELLED', endedAt: new Date() },
        });
        if (result.count === 0) return false;

        if (raid.energyCost > 0) {
          await tx.team.update({
            where: { id: raid.attackerTeamId },
            data: { energy: { increment: raid.energyCost } },
          });
        }
        return true;
      });

      if (expired) {
        await this.notifications.markTargetReadForTarget(raid.id);
        await this.monitoring.logAndBroadcast('RAID_RESULT', null, {
          raidId: raid.id,
          result: 'CANCELLED',
          energyRefunded: raid.energyCost,
        });
      }
    }
  }

  // Appelé après chaque défi quotidien complété — déclenche un raid si le seuil d'énergie est atteint
  async checkAndTriggerRaid(attackerTeamId: string) {
    await this.expireStalePendingRaids();
    const attackerTeam = await this.prisma.team.findUnique({ where: { id: attackerTeamId } });
    if (!attackerTeam || attackerTeam.energy < attackerTeam.energyThreshold) return null;

    const target = await this.prisma.territory.findFirst({
      where: { ownerTeamId: { not: attackerTeamId } },
      orderBy: { capturedAt: 'asc' },
    });
    if (!target || !target.ownerTeamId) return null;

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
        energyCost: attackerTeam.energyThreshold,
      },
    });

    await this.prisma.team.update({
      where: { id: attackerTeamId },
      data: { energy: { decrement: attackerTeam.energyThreshold } },
    });

    await this.monitoring.logAndBroadcast('RAID_TRIGGERED', null, {
      raidId: raid.id, attackerTeamId, defenderTeamId: target.ownerTeamId, territoryId: target.id,
    });

    await Promise.all([
      this.notifications.notifyTeam(
        attackerTeamId,
        'RAID_ATTACK',
        'Raid lancé par ton équipe',
        `Votre équipe attaque le territoire ${target.name}. L'énergie du seuil a été dépensée.`,
        raid.id,
      ),
      this.notifications.notifyTeam(
        target.ownerTeamId,
        'RAID_DEFENSE',
        'Votre territoire est attaqué',
        `Un raid vise le territoire ${target.name}. Rejoins ton équipe pour le défendre.`,
        raid.id,
      ),
    ]);

    return raid;
  }

  async getActiveRaidsForUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.teamId) return [];
    return this.getActiveRaidsForTeam(user.teamId);
  }

  async getActiveRaidsForTeam(teamId: string) {
    await this.expireStalePendingRaids();
    return this.prisma.raid.findMany({
      where: {
        status: { in: ['PENDING', 'IN_PROGRESS'] },
        OR: [{ attackerTeamId: teamId }, { defenderTeamId: teamId }],
      },
      include: { territory: true, attackerTeam: true, defenderTeam: true },
    });
  }

  // Détail complet d'un raid pour l'affichage — le contenu de la manche en cours est toujours filtré
  async getRaidDetail(raidId: string, userId: string) {
    await this.expireStalePendingRaids();
    const raid = await this.prisma.raid.findUnique({
      where: { id: raidId },
      include: {
        territory: true,
        attackerTeam: true,
        defenderTeam: true,
        participants: { include: { user: { select: { id: true, pseudo: true } } } },
        rounds: { orderBy: { roundNumber: 'asc' } },
      },
    });
    if (!raid) throw new NotFoundException('Raid introuvable');

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.teamId || ![raid.attackerTeamId, raid.defenderTeamId].includes(user.teamId)) {
      throw new ForbiddenException("Tu ne fais pas partie d'une équipe impliquée dans ce raid");
    }
    await this.notifications.markTargetRead(userId, raid.id);

    return {
      ...raid,
      rounds: raid.rounds.map((r) => ({
        ...r,
        content: this.stripAnswer(r.content, r.type),
      })),
    };
  }

  // Un membre d'une des deux équipes rejoint le raid
  async joinRaid(raidId: string, userId: string) {
    await this.expireStalePendingRaids();
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
      await this.notifications.markTargetReadForTarget(raidId);
    } else {
      await this.notifications.markTargetRead(userId, raidId);
    }

    return this.getRaidDetail(raidId, userId);
  }

  private generateRoundContent(type: (typeof ROUND_TYPES)[number]) {
    if (type === 'QUIZ') {
      return QUIZ_BANK[Math.floor(Math.random() * QUIZ_BANK.length)];
    }
    if (type === 'MEMORY') {
      const correctSequence = Array.from(
        { length: MEMORY_SEQUENCE_LENGTH },
        () => MEMORY_COLORS[Math.floor(Math.random() * MEMORY_COLORS.length)],
      );
      return { correctSequence };
    }
    // REFLEX n'a pas besoin de contenu — le score vient uniquement du temps de réaction mesuré serveur
    return {};
  }

  // Ne retire QUE ce qui doit rester secret. Pour QUIZ, la bonne réponse ne doit jamais être visible.
  // Pour MEMORY, la séquence EST le contenu à afficher au joueur (mémoriser puis reproduire) —
  // la retirer rendrait le jeu injouable, ce n'est pas un secret de la même nature qu'une réponse de quiz.
  private stripAnswer(content: any, type: string) {
    if (type === 'QUIZ') {
      const { correctAnswer, ...rest } = content ?? {};
      return rest;
    }
    return content ?? {};
  }
  private async startRound(raidId: string, roundNumber: number) {
    const type = ROUND_TYPES[(roundNumber - 1) % ROUND_TYPES.length];
    const content = this.generateRoundContent(type);
    return this.prisma.raidRound.create({
      data: { raidId, roundNumber, type, content, resultsData: {} },
    });
  }

  // Calcule et enregistre le score d'un joueur pour la manche en cours — correction 100% serveur
  async submitRoundAnswer(
    raidId: string,
    roundId: string,
    userId: string,
    answerData: Record<string, unknown>,
  ) {
    const raid = await this.prisma.raid.findUnique({
      where: { id: raidId },
      include: { participants: { where: { userId }, select: { teamId: true } } },
    });
    if (!raid) throw new NotFoundException('Raid introuvable');
    if (raid.status !== 'IN_PROGRESS') throw new BadRequestException('Ce raid ne reçoit plus de réponses');

    const participant = raid.participants[0];
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { teamId: true } });
    if (
      !participant || !user?.teamId || participant.teamId !== user.teamId ||
      ![raid.attackerTeamId, raid.defenderTeamId].includes(participant.teamId)
    ) {
      throw new ForbiddenException('Rejoins une des équipes du raid avant de répondre');
    }

    const round = await this.prisma.raidRound.findUnique({ where: { id: roundId } });
    if (!round || round.raidId !== raidId) throw new NotFoundException('Manche introuvable');
    if (round.endedAt) throw new BadRequestException('Manche déjà terminée');

    const resultsData = (round.resultsData as Record<string, number>) ?? {};
    if (resultsData[userId] !== undefined) {
      throw new BadRequestException('Tu as déjà répondu à cette manche');
    }

    const score = this.computeRoundScore(round, answerData);
    resultsData[userId] = score;

    await this.prisma.raidRound.update({ where: { id: roundId }, data: { resultsData } });
    await this.prisma.raidParticipant.updateMany({
      where: { raidId, userId },
      data: { totalScore: { increment: score } },
    });

    // Clôture automatique de la manche si tous les participants inscrits ont répondu
    const participants = await this.prisma.raidParticipant.findMany({ where: { raidId } });
    const allAnswered = participants.every((p) => resultsData[p.userId] !== undefined);

    let roundEnded = false;
    let raidResult: Awaited<ReturnType<RaidsService['finalizeRaid']>> = null;
    if (allAnswered) {
      roundEnded = true;
      raidResult = await this.endRound(raidId, roundId, round.roundNumber);
    }

    return { score, resultsData, roundEnded, raidResult };
  }

  private computeRoundScore(round: { type: string; content: any; startedAt: Date }, answerData: Record<string, unknown>): number {
    const content = round.content as any;

    if (round.type === 'QUIZ') {
      return answerData.selectedOption === content.correctAnswer ? 100 : 0;
    }

    if (round.type === 'MEMORY') {
      const submitted = Array.isArray(answerData.sequence) ? (answerData.sequence as string[]) : [];
      const correct = content.correctSequence as string[];
      let matchedPrefix = 0;
      for (let i = 0; i < correct.length; i++) {
        if (submitted[i] === correct[i]) matchedPrefix++;
        else break;
      }
      return Math.round((matchedPrefix / correct.length) * 100);
    }

    if (round.type === 'REFLEX') {
      // Le temps de réaction est calculé UNIQUEMENT à partir de l'horloge serveur —
      // l'instant de démarrage (round.startedAt) et l'instant de réception de cette requête.
      // Le client ne peut donc pas déclarer un temps de réaction inventé.
      const elapsedSeconds = (Date.now() - round.startedAt.getTime()) / 1000;
      return Math.max(0, Math.round(100 - elapsedSeconds * 20));
    }

    return 0;
  }

  private async endRound(raidId: string, roundId: string, roundNumber: number) {
    await this.prisma.raidRound.update({ where: { id: roundId }, data: { endedAt: new Date() } });

    if (roundNumber < 3) {
      await this.startRound(raidId, roundNumber + 1);
      return null;
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
      .filter((p) => p.teamId === raid.attackerTeamId)
      .reduce((s, p) => s + p.totalScore, 0);
    const defenderScore = raid.participants
      .filter((p) => p.teamId === raid.defenderTeamId)
      .reduce((s, p) => s + p.totalScore, 0);

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


    await this.notifications.markTargetReadForTarget(raidId);
    await this.monitoring.logAndBroadcast('RAID_RESULT', null, {
      raidId, result, attackerScore, defenderScore,
    });

    return { result, attackerScore, defenderScore };
  }
}