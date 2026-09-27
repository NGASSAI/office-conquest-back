import { IsIn, Matches } from 'class-validator';

// Liste fermée volontairement — empêche d'enregistrer n'importe quel contenu arbitraire comme "avatar"
export const ALLOWED_AVATAR_EMOJIS = [
  '🦊', '🐺', '🦉', '🐝', '🦅', '🐉', '🦁', '🐯', '🐨', '🦄', '🐧', '🦈',
] as const;

export class SetAvatarDto {
  @IsIn(ALLOWED_AVATAR_EMOJIS)
  emoji!: string;

  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'Couleur au format hexadécimal, ex: #C9A227' })
  color!: string;
}