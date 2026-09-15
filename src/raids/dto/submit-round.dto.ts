import { IsInt, Min, Max } from 'class-validator';

export class SubmitRoundDto {
  @IsInt()
  @Min(0)
  @Max(100)
  score: number;
}
