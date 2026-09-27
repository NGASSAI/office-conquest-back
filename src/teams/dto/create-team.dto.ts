import { IsString, IsInt, Min, MinLength, Matches } from 'class-validator';

export class CreateTeamDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'Couleur au format hexadécimal, ex: #C9A227' })
  color!: string;

  @IsInt()
  @Min(100)
  energyThreshold: number = 1000;
}