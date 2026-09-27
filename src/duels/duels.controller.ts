import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { DuelsService } from './duels.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateDuelDto } from './dto/create-duel.dto';
import { SubmitDuelAnswerDto } from './dto/submit-duel-answer.dto';

@Controller('duels')
export class DuelsController {
  constructor(private readonly duelsService: DuelsService) {}

  @Post()
  create(@Body() dto: CreateDuelDto, @CurrentUser() user: { userId: string }) {
    return this.duelsService.create(user.userId, dto.opponentId, dto.type);
  }

  @Get('mine')
  listMine(@CurrentUser() user: { userId: string }) {
    return this.duelsService.listForUser(user.userId);
  }

  @Get(':id')
  getOne(@Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.duelsService.getOne(id, user.userId);
  }

  @Post(':id/ready')
  markReady(@Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.duelsService.markReady(id, user.userId);
  }

  @Post(':id/answer')
  submitAnswer(
    @Param('id') id: string,
    @Body() dto: SubmitDuelAnswerDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.duelsService.submitAnswer(id, user.userId, dto.answerData);
  }
}