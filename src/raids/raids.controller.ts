import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { RaidsService } from './raids.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SubmitRoundAnswerDto } from './dto/submit-round-answer.dto';

@Controller('raids')
export class RaidsController {
  constructor(private readonly raidsService: RaidsService) {}

  @Get('active')
  getActive(@CurrentUser() user: { userId: string }) {
    return this.raidsService.getActiveRaidsForUser(user.userId);
  }

  @Get(':id')
  getDetail(@Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.raidsService.getRaidDetail(id, user.userId);
  }

  @Post(':id/join')
  join(@Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.raidsService.joinRaid(id, user.userId);
  }

  @Post(':id/rounds/:roundId/answer')
  submitAnswer(
    @Param('id') id: string,
    @Param('roundId') roundId: string,
    @Body() dto: SubmitRoundAnswerDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.raidsService.submitRoundAnswer(id, roundId, user.userId, dto.answerData);
  }
}