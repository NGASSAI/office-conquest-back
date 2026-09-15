import { IsString, IsIn } from 'class-validator';

export class CreateDuelDto {
  @IsString()
  opponentId: string;

  @IsIn(['QUIZ', 'MEMORY', 'REFLEX'])
  type: 'QUIZ' | 'MEMORY' | 'REFLEX';
}
