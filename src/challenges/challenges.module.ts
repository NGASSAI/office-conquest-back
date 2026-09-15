import { Module } from '@nestjs/common';
import { ChallengesController } from './challenges.controller';
import { ChallengesService } from './challenges.service';
import { TeamsModule } from '../teams/teams.module';
import { RaidsModule } from '../raids/raids.module';
import { MonitoringModule } from '../monitoring/monitoring.module';

@Module({
  imports: [TeamsModule, RaidsModule, MonitoringModule],
  controllers: [ChallengesController],
  providers: [ChallengesService],
  exports: [ChallengesService],
})
export class ChallengesModule {}
