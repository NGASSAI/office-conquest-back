import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { TerritoriesService } from './territories.service';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/role.enum';
import { CreateTerritoryDto } from './dto/create-territory.dto';
import { UpdateTerritoryDto } from './dto/update-territory.dto';

@Controller('territories')
export class TerritoriesController {
  constructor(private readonly territoriesService: TerritoriesService) {}

  @Public()
  @Get()
  getMap() {
    return this.territoriesService.getMapState();
  }

  @Roles(UserRole.ADMIN)
  @Post()
  create(@Body() dto: CreateTerritoryDto) {
    return this.territoriesService.create(dto);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTerritoryDto) {
    return this.territoriesService.update(id, dto);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.territoriesService.remove(id);
  }
}