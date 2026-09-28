import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TeamsService } from '../teams/teams.service';
import { RaidsService } from '../raids/raids.service';
import { MonitoringService } from '../monitoring/monitoring.service';
import { SubmitAttemptDto } from './dto/submit-attempt.dto';
import { CreateChallengeDto } from './dto/create-challenge.dto';
@Injectable()
export class ChallengesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly teamsService: TeamsService,
    private readonly raidsService: RaidsService,
    private readonly monitoring: MonitoringService,
  ) {}

  async getWeeklyGoal() {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setUTCHours(0, 0, 0, 0);
    weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7));
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

    const [completed, activePlayers] = await Promise.all([
      this.prisma.dailyChallengeAttempt.count({
        where: { completedAt: { gte: weekStart, lt: weekEnd } },
      }),
      this.prisma.user.count({ where: { status: 'ACTIVE' } }),
    ]);
    const target = Math.max(10, activePlayers * 3);

    return {
      completed,
      target,
      percent: Math.min(100, Math.round((completed / target) * 100)),
      endsAt: weekEnd.toISOString(),
    };
  }

  // Renvoie tous les défis du jour sans réponse correcte et avec l'état de tentative du joueur
  async getTodayForUser(userId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const challenges = await this.prisma.dailyChallenge.findMany({
      where: { date: today },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: {
        attempts: {
          where: { userId },
          select: { score: true },
        },
      },
    });

    return challenges.map((challenge) => {
      const attempt = challenge.attempts[0];
      return {
        id: challenge.id,
        type: challenge.type,
        title: challenge.title,
        difficulty: challenge.difficulty,
        content: this.stripAnswer(challenge.content as any, challenge.type),
        alreadyPlayed: !!attempt,
        previousScore: attempt?.score ?? null,
      };
    });
  }

   // Ne retire QUE ce qui doit rester secret. QUIZ/RIDDLE : la réponse ne doit jamais être visible.
  // MEMORY : la séquence EST le contenu à afficher (mémoriser puis reproduire), pas un secret à cacher.
  private stripAnswer(content: any, type: string) {
    if (type === 'MEMORY') return content ?? {};
    const { correctAnswer, oddSymbol, ...rest } = content ?? {};
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
    if (!user) throw new NotFoundException('Utilisateur introuvable');

    // Correction 100% côté serveur à partir du contenu stocké en base (jamais confiance au client)
    const score = this.computeScore(challenge, dto);
    const energyEarned = user.teamId ? Math.round(score * (challenge.difficulty || 1)) : 0;

    const attempt = await this.prisma.$transaction(async (tx) => {
      const createdAttempt = await tx.dailyChallengeAttempt.create({
        data: {
          userId, challengeId, score, energyEarned,
          answerData: dto.answerData as any,
        },
      });
      if (user.teamId && energyEarned > 0) {
        await tx.team.update({
          where: { id: user.teamId },
          data: { energy: { increment: energyEarned } },
        });
      }
      return createdAttempt;
    });

    await this.monitoring.logAndBroadcast('CHALLENGE_ATTEMPT', userId, {
      challengeId, score, energyEarned,
    });

    // Vérifie si le seuil d'énergie est atteint pour déclencher un raid automatique
    if (user.teamId) await this.raidsService.checkAndTriggerRaid(user.teamId);

    return { score, energyEarned, experienceEarned: 10 + Math.floor(score / 10) };
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
      case 'POLL':
        if (!Array.isArray(content.options) || !content.options.includes(dto.answerData.selectedOption as string)) {
          throw new BadRequestException('Choisis une option proposée dans le sondage');
        }
        return 0;
      case 'SPOT':
        correct = dto.answerData.selectedSymbol === content.oddSymbol &&
          Array.isArray(content.symbols) && content.symbols.includes(content.oddSymbol);
        break;
      case 'MEMORY':
        if (content.mode === 'PAIRS') {
          const pairSymbols = Array.isArray(content.pairSymbols) ? content.pairSymbols as string[] : [];
          const matchedSymbols = Array.isArray(dto.answerData.matchedSymbols)
            ? dto.answerData.matchedSymbols as string[]
            : [];
          const uniqueMatches = new Set(matchedSymbols.filter((symbol) => pairSymbols.includes(symbol)));
          const pairAttempts = dto.answerData.pairAttempts;
          if (
            pairSymbols.length < 3 || uniqueMatches.size !== pairSymbols.length ||
            !Number.isInteger(pairAttempts) || Number(pairAttempts) < pairSymbols.length
          ) return 0;

          return Math.max(40, Math.round((pairSymbols.length / Number(pairAttempts)) * 100));
        }
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

    async create(dto: CreateChallengeDto) {
    this.validateContentShape(dto.type, dto.content);

    const date = new Date(dto.date);
    date.setHours(0, 0, 0, 0);

    return this.prisma.dailyChallenge.create({
      data: { date, type: dto.type, title: dto.title, content: dto.content as import('@prisma/client').Prisma.InputJsonValue, difficulty: dto.difficulty },
    });
  }

  // Empêche un admin de publier par erreur un contenu incomplet (ex: QUIZ sans correctAnswer)
  // qui rendrait le défi injouable ou impossible à corriger côté serveur.
  private validateContentShape(type: string, content: Record<string, unknown>) {
    if (type === 'QUIZ') {
      if (!content.question || !Array.isArray(content.options) || !content.correctAnswer) {
        throw new BadRequestException('QUIZ requiert : question, options (tableau), correctAnswer');
      }
      if (!(content.options as string[]).includes(content.correctAnswer as string)) {
        throw new BadRequestException('correctAnswer doit être une des options proposées');
      }
    } else if (type === 'RIDDLE') {
      if (!content.question || !content.correctAnswer) {
        throw new BadRequestException('RIDDLE requiert : question, correctAnswer');
      }
    } else if (type === 'POLL') {
      const options = content.options;
      if (
        typeof content.question !== 'string' || !content.question.trim() ||
        !Array.isArray(options) || options.length < 2 || options.length > 4 ||
        options.some((option) => typeof option !== 'string' || !option.trim()) ||
        new Set(options).size !== options.length
      ) {
        throw new BadRequestException('POLL requiert une question et 2 à 4 choix');
      }
      const symbols = content.symbols;
      const mainSymbols = Array.isArray(symbols)
        ? [...new Set(symbols.filter((symbol) => symbol !== content.oddSymbol))]
        : [];
      if (
        typeof content.question !== 'string' || !content.question.trim() ||
        !Array.isArray(symbols) || symbols.length !== 9 ||
        symbols.some((symbol) => typeof symbol !== 'string' || !symbol.trim()) ||
        typeof content.oddSymbol !== 'string' ||
        symbols.filter((symbol) => symbol === content.oddSymbol).length !== 1 ||
        mainSymbols.length !== 1 || symbols.filter((symbol) => symbol !== content.oddSymbol).length !== 8
      ) {
        throw new BadRequestException('SPOT requiert une question, 9 icônes et un seul intrus');
      }
    } else if (type === 'MEMORY') {
      if (content.mode === 'PAIRS') {
        const pairSymbols = content.pairSymbols;
        if (
          !Array.isArray(pairSymbols) || pairSymbols.length < 3 || pairSymbols.length > 8 ||
          pairSymbols.some((symbol) => typeof symbol !== 'string' || symbol.length === 0) ||
          new Set(pairSymbols).size !== pairSymbols.length
        ) {
          throw new BadRequestException('MEMORY PAIRES requiert 3 à 8 icônes différentes');
        }
      } else if (!Array.isArray(content.correctSequence) || content.correctSequence.length === 0) {
        throw new BadRequestException('MEMORY requiert une séquence non vide');
      }
    }
    // REFLEX n'a besoin d'aucun contenu
  }

  async listAll() {
    return this.prisma.dailyChallenge.findMany({
      orderBy: { date: 'desc' },
      take: 30,
      include: { _count: { select: { attempts: true } } },
    });
  }

  async remove(id: string) {
    const challenge = await this.prisma.dailyChallenge.findUnique({ where: { id } });
    if (!challenge) throw new NotFoundException('Défi introuvable');

    await this.prisma.dailyChallenge.delete({ where: { id } });
    return { message: 'Défi supprimé' };
  }
}
