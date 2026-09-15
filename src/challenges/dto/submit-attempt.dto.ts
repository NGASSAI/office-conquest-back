import { IsObject, IsInt, Min, Max } from 'class-validator';

export class SubmitAttemptDto {
  // Réponse brute du joueur — la structure dépend du type de défi (validée côté service)
  @IsObject()
  answerData: Record<string, unknown>;

  // Temps mis en secondes, pour moduler le score (les défis rapidité en ont besoin)
  @IsInt()
  @Min(0)
  @Max(3600)
  timeTakenSeconds: number;
}
