import { IsString, MinLength, Matches } from 'class-validator';

export class ConfirmPasswordResetDto {
  @IsString()
  token!: string;

  @IsString()
  @MinLength(10, { message: '10 caractères minimum' })
  @Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'Le mot de passe doit contenir majuscule, minuscule et chiffre',
  })
  newPassword!: string;
}