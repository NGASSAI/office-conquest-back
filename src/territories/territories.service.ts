import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TerritoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async getMapState() {
    return this.prisma.territory.findMany({
      include: { ownerTeam: { select: { id: true, name: true, color: true } } },
    });
  }

  // Transfère un territoire à l'équipe attaquante suite à un raid gagné
  async captureTerritory(territoryId: string, newOwnerTeamId: string) {
    return this.prisma.territory.update({
      where: { id: territoryId },
      data: { ownerTeamId: newOwnerTeamId, capturedAt: new Date() },
    });
  }
}
