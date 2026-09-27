import { IsString, IsInt, Min, MinLength, Matches, IsOptional } from 'class-validator';

export class UpdateTeamAdminDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'Couleur au format hexadécimal, ex: #C9A227' })
  color?: string;

  @IsOptional()
  @IsInt()
  @Min(100)
  energyThreshold?: number;
}