import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TeamsService } from '../teams/teams.service';
import { RaidsService } from '../raids/raids.service';
import { MonitoringService } from '../monitoring/monitoring.service';
import { SubmitAttemptDto } from './dto/submit-attempt.dto';

@Injectable()
export class ChallengesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly teamsService: TeamsService,
    private readonly raidsService: RaidsService,
    private readonly monitoring: MonitoringService,
  ) {}

  // Renvoie le défi du jour SANS la réponse correcte, + indique si l'utilisateur a déjà joué
  async getTodayForUser(userId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const challenge = await this.prisma.dailyChallenge.findUnique({ where: { date: today } });
    if (!challenge) throw new NotFoundException("Pas de défi disponible aujourd'hui");

    const attempt = await this.prisma.dailyChallengeAttempt.findUnique({
      where: { userId_challengeId: { userId, challengeId: challenge.id } },
    });

    const publicContent = this.stripAnswer(challenge.content as any, challenge.type);

    return {
      id: challenge.id,
      type: challenge.type,
      title: challenge.title,
      difficulty: challenge.difficulty,
      content: publicContent,
      alreadyPlayed: !!attempt,
      previousScore: attempt?.score ?? null,
    };
  }

  // Retire la/les bonnes réponses du contenu envoyé au client — la correction se fait uniquement côté serveur
  private stripAnswer(content: any, type: string) {
    const { correctAnswer, correctSequence, ...rest } = content ?? {};
    return rest;
  }

  async submitAttempt(challengeId: string, userId: string, dto: SubmitAttemptDto) {
    const challenge = await this.prisma.dailyChallenge.findUnique({ where: { id: challengeId } });
    if (!challenge) throw new NotFoundException('Défi introuvable');

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (challenge.date.getTime() !== today.getTime()) {
      throw new BadRequestException("Ce défi n'est plus jouable aujourd'hui");
    }

    // La contrainte unique @@unique([userId, challengeId]) empêche aussi la triche par rejeu concurrent
    const existing = await this.prisma.dailyChallengeAttempt.findUnique({
      where: { userId_challengeId: { userId, challengeId } },
    });
    if (existing) throw new ConflictException('Défi déjà joué aujourd\'hui');

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.teamId) throw new BadRequestException('Rejoins une équipe avant de jouer');

    // Correction 100% côté serveur à partir du contenu stocké en base (jamais confiance au client)
    const score = this.computeScore(challenge, dto);
    const energyEarned = Math.round(score * (challenge.difficulty || 1));

    const [attempt] = await this.prisma.$transaction([
      this.prisma.dailyChallengeAttempt.create({
        data: {
          userId, challengeId, score, energyEarned,
          answerData: dto.answerData as any,
        },
      }),
      this.prisma.team.update({
        where: { id: user.teamId },
        data: { energy: { increment: energyEarned } },
      }),
    ]);

    await this.monitoring.logAndBroadcast('CHALLENGE_ATTEMPT', userId, {
      challengeId, score, energyEarned,
    });

    // Vérifie si le seuil d'énergie est atteint pour déclencher un raid automatique
    await this.raidsService.checkAndTriggerRaid(user.teamId);

    return { score, energyEarned };
  }

  private computeScore(challenge: any, dto: SubmitAttemptDto): number {
    const content = challenge.content as any;
    let correct = false;

    switch (challenge.type) {
      case 'QUIZ':
        correct = dto.answerData.selectedOption === content.correctAnswer;
        break;
      case 'RIDDLE':
        correct =
          typeof dto.answerData.answer === 'string' &&
          dto.answerData.answer.trim().toLowerCase() === String(content.correctAnswer).trim().toLowerCase();
        break;
      case 'MEMORY':
        correct = JSON.stringify(dto.answerData.sequence) === JSON.stringify(content.correctSequence);
        break;
      case 'REFLEX':
        // Score basé sur le temps de réaction, borné pour éviter les valeurs absurdes envoyées par le client
        correct = true;
        break;
      default:
        correct = false;
    }

    if (!correct) return 0;

    // Bonus de rapidité : plus vite = plus de points, borné entre 50 et 100
    const speedBonus = Math.max(0, 50 - dto.timeTakenSeconds);
    return Math.min(100, 50 + speedBonus);
  }

  async create(dto: any) {
    return this.prisma.dailyChallenge.create({ data: dto });
  }
}
