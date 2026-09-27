import { IsObject } from 'class-validator';

export class SubmitRoundAnswerDto {
  @IsObject()
  answerData: Record<string, unknown> = {};
}