import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MonitoringService } from '../monitoring/monitoring.service';

@Injectable()
export class DuelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly monitoring: MonitoringService,
  ) {}

  async create(player1Id: string, opponentId: string, type: 'QUIZ' | 'MEMORY' | 'REFLEX') {
    if (player1Id === opponentId) throw new BadRequestException('Impossible de te défier toi-même');

    const opponent = await this.prisma.user.findUnique({ where: { id: opponentId } });
    if (!opponent || opponent.status === 'BLOCKED') throw new NotFoundException('Adversaire introuvable');

    return this.prisma.duel.create({
      data: { player1Id, player2Id: opponentId, type, status: 'PENDING' },
    });
  }

  // Scores stockés séparément par joueur via metadata, simplifié ici avec deux appels successifs
  async submitScore(duelId: string, userId: string, score: number) {
    const duel = await this.prisma.duel.findUnique({ where: { id: duelId } });
    if (!duel) throw new NotFoundException('Duel introuvable');
    if (![duel.player1Id, duel.player2Id].includes(userId)) {
      throw new ForbiddenException("Tu ne fais pas partie de ce duel");
    }
    if (duel.status === 'COMPLETED') throw new BadRequestException('Duel déjà terminé');

    const scores = (duel.scores as Record<string, number>) ?? {};
    scores[userId] = score;

    const bothPlayed = scores[duel.player1Id] !== undefined && scores[duel.player2Id] !== undefined;

    let winnerId: string | null = null;
    let status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' = 'IN_PROGRESS';

    if (bothPlayed) {
      status = 'COMPLETED';
      if (scores[duel.player1Id] !== scores[duel.player2Id]) {
        winnerId = scores[duel.player1Id] > scores[duel.player2Id] ? duel.player1Id : duel.player2Id;
      }
    }

    const updated = await this.prisma.duel.update({
      where: { id: duelId },
      data: { status, winnerId, scores, completedAt: bothPlayed ? new Date() : null },
    });

    if (bothPlayed) {
      await this.monitoring.logAndBroadcast('DUEL_RESULT', winnerId, { duelId, scores });
    }

    return updated;
  }

  async listForUser(userId: string) {
    return this.prisma.duel.findMany({
      where: { OR: [{ player1Id: userId }, { player2Id: userId }] },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }
}
