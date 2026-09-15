import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { RaidsService } from './raids.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SubmitRoundDto } from './dto/submit-round.dto';

@Controller('raids')
export class RaidsController {
  constructor(private readonly raidsService: RaidsService) {}

  @Get('active')
  getActive(@CurrentUser() user: { userId: string }) {
    return this.raidsService.getActiveRaidsForUser(user.userId);
  }

  @Post(':id/join')
  join(@Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.raidsService.joinRaid(id, user.userId);
  }

  @Post(':id/rounds/:roundId/score')
  submitScore(
    @Param('id') id: string,
    @Param('roundId') roundId: string,
    @Body() dto: SubmitRoundDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.raidsService.submitRoundScore(id, roundId, user.userId, dto.score);
  }
}
