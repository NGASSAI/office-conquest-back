import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { TeamsService } from './teams.service';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/role.enum';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamAdminDto } from './dto/update-team-admin.dto';

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

  @Roles(UserRole.ADMIN)
  @Post()
  create(@Body() dto: CreateTeamDto) {
    return this.teamsService.create(dto);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTeamAdminDto) {
    return this.teamsService.update(id, dto);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.teamsService.remove(id);
  }
}