import { IsString, MinLength, IsOptional } from 'class-validator';

export class CreateTerritoryDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsString()
  ownerTeamId?: string; // territoire neutre si non fourni
}