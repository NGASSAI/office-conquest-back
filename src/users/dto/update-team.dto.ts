import { IsOptional, IsString } from 'class-validator';

export class UpdateTeamDto {
  @IsOptional()
  @IsString()
  teamId?: string | null;
}
