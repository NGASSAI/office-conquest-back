import { Controller, Get } from '@nestjs/common';
import { TerritoriesService } from './territories.service';
import { Public } from '../common/decorators/public.decorator';

@Controller('territories')
export class TerritoriesController {
  constructor(private readonly territoriesService: TerritoriesService) {}

  @Public()
  @Get()
  getMap() {
    return this.territoriesService.getMapState();
  }
}
