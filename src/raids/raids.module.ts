import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { RaidsController } from './raids.controller';
import { RaidsService } from './raids.service';
import { RaidsGateway } from './raids.gateway';
import { MonitoringModule } from '../monitoring/monitoring.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [MonitoringModule, NotificationsModule, JwtModule.register({})],
  controllers: [RaidsController],
  providers: [RaidsService, RaidsGateway],
  exports: [RaidsService],
})
export class RaidsModule {}
