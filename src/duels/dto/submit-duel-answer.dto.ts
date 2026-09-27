import { IsObject } from 'class-validator';

export class SubmitDuelAnswerDto {
  @IsObject()
  answerData!: Record<string, unknown>;
}