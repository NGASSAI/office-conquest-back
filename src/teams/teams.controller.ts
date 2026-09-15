import { Controller, Get, Param } from '@nestjs/common';
import { TeamsService } from './teams.service';
import { Public } from '../common/decorators/public.decorator';

@Controller('teams')
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  // Public : la carte des équipes/territoires est visible même sans compte (vitrine du jeu)
  @Public()
  @Get()
  list() {
    return this.teamsService.listWithStats();
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.teamsService.getDetails(id);
  }
}
