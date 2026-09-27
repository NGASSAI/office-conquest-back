import { IsString, MinLength, IsOptional } from 'class-validator';

export class UpdateTerritoryDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  ownerTeamId?: string;
}