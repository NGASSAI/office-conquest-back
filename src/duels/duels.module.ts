import { Module } from '@nestjs/common';
import { DuelsController } from './duels.controller';
import { DuelsService } from './duels.service';
import { MonitoringModule } from '../monitoring/monitoring.module';

@Module({
  imports: [MonitoringModule],
  controllers: [DuelsController],
  providers: [DuelsService],
  exports: [DuelsService],
})
export class DuelsModule {}
