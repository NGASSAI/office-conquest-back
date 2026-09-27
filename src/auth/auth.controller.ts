import { Body, Controller, Post, Req, Res, HttpCode, HttpStatus } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifySecretPhraseDto } from './dto/verify-secret-phrase.dto';
import { ConfirmPasswordResetDto } from './dto/confirm-password-reset.dto';
import { Public } from '../common/decorators/public.decorator';

const REFRESH_COOKIE = 'refresh_token';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: IS_PRODUCTION, // HTTPS obligatoire en prod (Render/Vercel) ; désactivé en local pour que le cookie s'enregistre sur http://localhost
  sameSite: (IS_PRODUCTION ? 'none' : 'lax') as 'none' | 'lax', // 'lax' suffit en local (même "site" malgré les ports différents)
  path: '/',
};

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // anti brute-force sur l'inscription
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken } = await this.authService.register(
      dto,
      req.ip ?? '',
      req.headers['user-agent'],
    );
    res.cookie(REFRESH_COOKIE, refreshToken, COOKIE_OPTIONS);
    return { accessToken };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // anti brute-force sur le login
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken } = await this.authService.login(
      dto,
      req.ip ?? '',
      req.headers['user-agent'],
    );
    res.cookie(REFRESH_COOKIE, refreshToken, COOKIE_OPTIONS);
    return { accessToken };
  }

  // Appelé automatiquement par le frontend au chargement pour restaurer la session (remember me)
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = req.cookies?.[REFRESH_COOKIE];
    const result = await this.authService.refresh(
      refreshToken,
      req.ip ?? '',
      req.headers['user-agent'],
    );
    res.cookie(REFRESH_COOKIE, result.refreshToken, COOKIE_OPTIONS);
    return { accessToken: result.accessToken };
  }

  @HttpCode(HttpStatus.OK)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = req.cookies?.[REFRESH_COOKIE];
    if (refreshToken) await this.authService.logout(refreshToken);
    res.clearCookie(REFRESH_COOKIE, COOKIE_OPTIONS);
    return { success: true };
  }

  // Étape 1 (email) + étape 2 (phrase secrète) de l'UI sont regroupées ici en un seul appel
  // atomique côté serveur — aucune confirmation séparée sur l'existence de l'email.
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @Post('password-reset/verify')
  async verifySecretPhrase(@Body() dto: VerifySecretPhraseDto, @Req() req: Request) {
    return this.authService.verifySecretPhraseAndIssueResetToken(
      dto.email,
      dto.secretPhrase,
      req.ip ?? '',
    );
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @Post('password-reset/confirm')
  async confirmPasswordReset(@Body() dto: ConfirmPasswordResetDto, @Req() req: Request) {
    return this.authService.confirmPasswordReset(dto.token, dto.newPassword, req.ip ?? '');
  }
}