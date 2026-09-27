import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MonitoringService } from '../monitoring/monitoring.service';

const QUIZ_BANK = [
  { question: 'Combien de territoires compte la carte du bureau ?', options: ['3', '5', '8', '10'], correctAnswer: '5' },
  { question: "Quel est le seuil d'énergie par défaut pour déclencher un raid ?", options: ['500', '1000', '2000', '5000'], correctAnswer: '1000' },
  { question: 'Combien de manches compte un raid ?', options: ['1', '2', '3', '5'], correctAnswer: '3' },
];
const MEMORY_SEQUENCE_LENGTH = 5;
const MEMORY_COLORS = ['red', 'blue', 'green', 'yellow'] as const;

@Injectable()
export class DuelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly monitoring: MonitoringService,
  ) {}

  private generateContent(type: 'QUIZ' | 'MEMORY' | 'REFLEX') {
    if (type === 'QUIZ') return QUIZ_BANK[Math.floor(Math.random() * QUIZ_BANK.length)];
    if (type === 'MEMORY') {
      return {
        correctSequence: Array.from(
          { length: MEMORY_SEQUENCE_LENGTH },
          () => MEMORY_COLORS[Math.floor(Math.random() * MEMORY_COLORS.length)],
        ),
      };
    }
    return {};
  }

  // MEMORY doit rester visible (c'est le contenu à mémoriser) ; QUIZ doit cacher la réponse
  private stripAnswer(content: any, type: string) {
    if (type === 'MEMORY') return content ?? {};
    const { correctAnswer, ...rest } = content ?? {};
    return rest;
  }

  async create(player1Id: string, opponentId: string, type: 'QUIZ' | 'MEMORY' | 'REFLEX') {
    if (player1Id === opponentId) throw new BadRequestException('Impossible de te défier toi-même');

    const opponent = await this.prisma.user.findUnique({ where: { id: opponentId } });
    if (!opponent || opponent.status === 'BLOCKED') throw new NotFoundException('Adversaire introuvable');

    const duel = await this.prisma.duel.create({
      data: {
        player1Id,
        player2Id: opponentId,
        type,
        status: 'PENDING',
        content: this.generateContent(type),
      },
    });

    return this.toPublicDuel(duel);
  }

  async getOne(duelId: string, userId: string) {
    const duel = await this.prisma.duel.findUnique({ where: { id: duelId } });
    if (!duel) throw new NotFoundException('Duel introuvable');
    if (![duel.player1Id, duel.player2Id].includes(userId)) {
      throw new ForbiddenException("Tu ne fais pas partie de ce duel");
    }
    return this.toPublicDuel(duel);
  }

  // Marque le joueur comme "prêt" côté serveur — horodatage utilisé pour chronométrer un éventuel REFLEX
  // sans jamais faire confiance à un temps envoyé par le client.
  async markReady(duelId: string, userId: string) {
    const duel = await this.prisma.duel.findUnique({ where: { id: duelId } });
    if (!duel) throw new NotFoundException('Duel introuvable');
    if (![duel.player1Id, duel.player2Id].includes(userId)) {
      throw new ForbiddenException("Tu ne fais pas partie de ce duel");
    }

    const playerReadyAt = (duel.playerReadyAt as Record<string, number>) ?? {};
    if (playerReadyAt[userId] === undefined) {
      playerReadyAt[userId] = Date.now();
      await this.prisma.duel.update({ where: { id: duelId }, data: { playerReadyAt } });
    }
    return { readyAt: playerReadyAt[userId] };
  }

  async submitAnswer(duelId: string, userId: string, answerData: Record<string, unknown>) {
    const duel = await this.prisma.duel.findUnique({ where: { id: duelId } });
    if (!duel) throw new NotFoundException('Duel introuvable');
    if (![duel.player1Id, duel.player2Id].includes(userId)) {
      throw new ForbiddenException("Tu ne fais pas partie de ce duel");
    }
    if (duel.status === 'COMPLETED') throw new BadRequestException('Duel déjà terminé');

    const scores = (duel.scores as Record<string, number>) ?? {};
    if (scores[userId] !== undefined) {
      throw new BadRequestException('Tu as déjà répondu à ce duel');
    }

    scores[userId] = this.computeScore(duel, userId, answerData);

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

    return { ...this.toPublicDuel(updated), myScore: scores[userId], bothPlayed };
  }

  private computeScore(duel: any, userId: string, answerData: Record<string, unknown>): number {
    const content = duel.content as any;

    if (duel.type === 'QUIZ') {
      return answerData.selectedOption === content.correctAnswer ? 100 : 0;
    }

    if (duel.type === 'MEMORY') {
      const submitted = Array.isArray(answerData.sequence) ? (answerData.sequence as string[]) : [];
      const correct = content.correctSequence as string[];
      let matchedPrefix = 0;
      for (let i = 0; i < correct.length; i++) {
        if (submitted[i] === correct[i]) matchedPrefix++;
        else break;
      }
      return Math.round((matchedPrefix / correct.length) * 100);
    }

    if (duel.type === 'REFLEX') {
      // Chronométré à partir de l'horodatage serveur posé par markReady() — jamais un temps envoyé par le client
      const playerReadyAt = (duel.playerReadyAt as Record<string, number>) ?? {};
      const readyAt = playerReadyAt[userId];
      if (!readyAt) return 0;
      const elapsedSeconds = (Date.now() - readyAt) / 1000;
      return Math.max(0, Math.round(100 - elapsedSeconds * 20));
    }

    return 0;
  }

  async listForUser(userId: string) {
    const duels = await this.prisma.duel.findMany({
      where: { OR: [{ player1Id: userId }, { player2Id: userId }] },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        player1: { select: { pseudo: true } },
        player2: { select: { pseudo: true } },
      },
    });
    return duels.map((d) => this.toPublicDuel(d));
  }

  private toPublicDuel(duel: any) {
    return { ...duel, content: this.stripAnswer(duel.content, duel.type) };
  }
}