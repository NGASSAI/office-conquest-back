import { IsString, MinLength, MaxLength } from 'class-validator';

export class SetSecretPhraseDto {
  @IsString()
  @MinLength(6, { message: '6 caractères minimum' })
  @MaxLength(100)
  secretPhrase!: string;
}