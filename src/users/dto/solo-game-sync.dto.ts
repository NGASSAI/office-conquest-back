import { IsNumber, IsOptional, IsString } from 'class-validator';

export class SoloGameSyncDto {
  @IsOptional()
  @IsNumber()
  score?: number;

  @IsOptional()
  @IsNumber()
  distance?: number;

  @IsOptional()
  @IsNumber()
  highScore?: number;

  @IsOptional()
  @IsNumber()
  totalGames?: number;

  @IsOptional()
  @IsNumber()
  totalDistance?: number;

  @IsOptional()
  @IsString()
  lastPlayed?: string;
}
