import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { DuelsService } from './duels.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateDuelDto } from './dto/create-duel.dto';
import { SubmitDuelScoreDto } from './dto/submit-duel-score.dto';

@Controller('duels')
export class DuelsController {
  constructor(private readonly duelsService: DuelsService) {}

  @Post()
  create(@Body() dto: CreateDuelDto, @CurrentUser() user: { userId: string }) {
    return this.duelsService.create(user.userId, dto.opponentId, dto.type);
  }

  @Post(':id/score')
  submitScore(
    @Param('id') id: string,
    @Body() dto: SubmitDuelScoreDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.duelsService.submitScore(id, user.userId, dto.score);
  }

  @Get('mine')
  listMine(@CurrentUser() user: { userId: string }) {
    return this.duelsService.listForUser(user.userId);
  }
}
