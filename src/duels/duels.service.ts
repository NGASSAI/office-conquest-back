import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MonitoringService } from '../monitoring/monitoring.service';
import { NotificationsService } from '../notifications/notifications.service';

const QUIZ_BANK = [
  { question: 'Combien de territoires compte la carte du bureau ?', options: ['3', '5', '8', '10'], correctAnswer: '5' },
  { question: "Quel est le seuil d'énergie par défaut pour déclencher un raid ?", options: ['500', '1000', '2000', '5000'], correctAnswer: '1000' },
  { question: 'Combien de manches compte un raid ?', options: ['1', '2', '3', '5'], correctAnswer: '3' },
  { question: 'Quel type de défi permet de gagner de l\'énergie pour ton équipe ?', options: ['Quiz uniquement', 'Défis quotidiens', 'Raids uniquement', 'Duels'], correctAnswer: 'Défis quotidiens' },
  { question: 'Combien de joueurs peuvent participer à un duel ?', options: ['1', '2', '4', '10'], correctAnswer: '2' },
  { question: 'Que se passe-t-il quand une équipe atteint le seuil d\'énergie ?', options: ['Rien', 'Un raid est déclenché', 'L\'équipe gagne', 'Le jeu s\'arrête'], correctAnswer: 'Un raid est déclenché' },
  { question: 'Quel est le but principal des raids ?', options: ['Gagner de l\'énergie', 'Capturer des territoires', 'Gagner des duels', 'Faire des quiz'], correctAnswer: 'Capturer des territoires' },
  { question: 'Combien de types de défis quotidiens existent-ils ?', options: ['2', '3', '5', '6'], correctAnswer: '6' },
  { question: 'Quel défi nécessite de mémoriser une séquence de couleurs ?', options: ['Quiz', 'Memory', 'Réflexe', 'Énigme'], correctAnswer: 'Memory' },
  { question: 'Dans un duel, comment le gagnant est-il déterminé ?', options: ['Le plus rapide', 'Le meilleur score', 'Le plus de duels', 'Au hasard'], correctAnswer: 'Le meilleur score' },
  { question: 'Que signifie le statut "BLOCKED" pour un utilisateur ?', options: ['Hors ligne', 'Compte bloqué', 'En pause', 'Nouveau joueur'], correctAnswer: 'Compte bloqué' },
  { question: 'Combien de temps dure un access token par défaut ?', options: ['5 minutes', '15 minutes', '1 heure', '24 heures'], correctAnswer: '15 minutes' },
  { question: 'Quel mécanisme permet de rester connecté après fermeture du navigateur ?', options: ['Access token', 'Refresh token', 'Cookie session', 'LocalStorage'], correctAnswer: 'Refresh token' },
  { question: 'Combien d\'équipes peuvent participer à un raid ?', options: ['1', '2', '3', '4'], correctAnswer: '2' },
  { question: 'Quel défi teste ta vitesse de réaction ?', options: ['Quiz', 'Memory', 'Réflexe', 'Sondage'], correctAnswer: 'Réflexe' },
  { question: 'Comment changer d\'équipe ?', options: ['Impossible', 'Via un admin', 'Librement', 'Après 30 jours'], correctAnswer: 'Librement' },
  { question: 'Quel est le rôle des notifications ?', options: ['Spam', 'Informer des événements', 'Décorer', 'Rien'], correctAnswer: 'Informer des événements' },
  { question: 'Combien de tentatives de login avant verrouillage ?', options: ['3', '5', '10', 'Illimité'], correctAnswer: '5' },
  { question: 'Qu\'est-ce qu\'un duel 1v1 ?', options: ['Duel en équipe', 'Duel solo contre un adversaire', 'Duel contre l\'IA', 'Tournoi'], correctAnswer: 'Duel solo contre un adversaire' },
  { question: 'Quel défi implique de choisir parmi plusieurs options ?', options: ['Memory', 'Quiz', 'Réflexe', 'Spot'], correctAnswer: 'Quiz' },
];
const MEMORY_SEQUENCE_LENGTH = 5;
const MEMORY_COLORS = ['red', 'blue', 'green', 'yellow'] as const;

@Injectable()
export class DuelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly monitoring: MonitoringService,
    private readonly notifications: NotificationsService,
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
    const challenger = await this.prisma.user.findUnique({
      where: { id: player1Id },
      select: { pseudo: true },
    });
    if (!challenger) throw new NotFoundException('Utilisateur introuvable');

    const duel = await this.prisma.duel.create({
      data: {
        player1Id,
        player2Id: opponentId,
        type,
        status: 'PENDING',
        content: this.generateContent(type),
      },
    });

    await this.notifications.notifyUser(
      opponentId,
      'DUEL_INVITE',
      'Nouveau duel',
      `${challenger.pseudo} te défie en ${type === 'QUIZ' ? 'quiz' : type === 'MEMORY' ? 'Memory' : 'réflexe'}.`,
      duel.id,
    );

    return this.toPublicDuel(duel);
  }

   async getOne(duelId: string, userId: string) {
    const duel = await this.prisma.duel.findUnique({
      where: { id: duelId },
      include: {
        player1: { select: { pseudo: true } },
        player2: { select: { pseudo: true } },
      },
    });
    if (!duel) throw new NotFoundException('Duel introuvable');
    if (![duel.player1Id, duel.player2Id].includes(userId)) {
      throw new ForbiddenException("Tu ne fais pas partie de ce duel");
    }
    await this.notifications.markTargetRead(userId, duel.id);
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
    await this.notifications.markTargetRead(userId, duel.id);

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
      await Promise.all([
        this.notifications.markTargetRead(duel.player1Id, duel.id),
        this.notifications.markTargetRead(duel.player2Id, duel.id),
      ]);
    } else {
      const opponentId = userId === duel.player1Id ? duel.player2Id : duel.player1Id;
      const responder = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { pseudo: true },
      });
      await this.notifications.notifyUser(
        opponentId,
        'DUEL_RESPONSE',
        'Ton duel avance',
        `${responder?.pseudo ?? 'Ton adversaire'} a joué son duel. À toi de répondre.`,
        duelId,
      );
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