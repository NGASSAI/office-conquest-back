import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { MonitoringModule } from '../monitoring/monitoring.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [MonitoringModule, AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
