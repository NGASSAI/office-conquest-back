import { IsDateString, IsEnum, IsInt, IsObject, IsString, Max, Min, MinLength } from 'class-validator';

enum ChallengeType {
  QUIZ = 'QUIZ',
  RIDDLE = 'RIDDLE',
  MEMORY = 'MEMORY',
  REFLEX = 'REFLEX',
  POLL = 'POLL',
  SPOT = 'SPOT',
}

export class CreateChallengeDto {
  @IsDateString()
  date!: string; // format ISO ("2026-09-28") — plusieurs défis peuvent partager une date

  @IsEnum(ChallengeType)
  type!: ChallengeType;

  @IsString()
  @MinLength(3)
  title!: string;

  // La forme exacte dépend du type — validée manuellement dans le service, pas ici,
  // pour rester flexible entre QUIZ, POLL, RIDDLE, MEMORY et REFLEX.
  @IsObject()
  content!: Record<string, unknown>;

  @IsInt()
  @Min(1)
  @Max(5)
  difficulty! : number;
}