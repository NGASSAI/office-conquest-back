import { Body, Controller, Get, Post, Param } from '@nestjs/common';
import { ChallengesService } from './challenges.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SubmitAttemptDto } from './dto/submit-attempt.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('challenges')
export class ChallengesController {
  constructor(private readonly challengesService: ChallengesService) {}

  // Défi du jour — le contenu renvoyé au joueur ne contient JAMAIS la bonne réponse
  @Get('today')
  getToday(@CurrentUser() user: { userId: string }) {
    return this.challengesService.getTodayForUser(user.userId);
  }

  @Post(':id/attempt')
  submit(
    @Param('id') id: string,
    @Body() dto: SubmitAttemptDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.challengesService.submitAttempt(id, user.userId, dto);
  }

  @Roles(UserRole.ADMIN)
  @Post()
  create(@Body() dto: any) {
    return this.challengesService.create(dto);
  }
}
