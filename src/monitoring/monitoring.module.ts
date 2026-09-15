import { Module } from '@nestjs/common';
import { MonitoringGateway } from './monitoring.gateway';
import { MonitoringService } from './monitoring.service';

@Module({
  providers: [MonitoringGateway, MonitoringService],
  exports: [MonitoringService],
})
export class MonitoringModule {}
