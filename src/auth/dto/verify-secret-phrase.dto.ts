import { IsEmail, IsString, MinLength } from 'class-validator';

export class VerifySecretPhraseDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  secretPhrase!: string;
}