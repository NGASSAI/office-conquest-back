import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MonitoringGateway } from './monitoring.gateway';

@Injectable()
export class MonitoringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: MonitoringGateway,
  ) {}

  // Log une activité en base ET la pousse en direct au dashboard admin
  async logAndBroadcast(type: string, userId: string | null, metadata?: object) {
    const log = await this.prisma.activityLog.create({
      data: { type: type as any, userId, metadata },
    });
    this.gateway.emitEvent('activity', log);
    return log;
  }
}
