import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTerritoryDto } from './dto/create-territory.dto';
import { UpdateTerritoryDto } from './dto/update-territory.dto';

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

  // --- Admin ---

  async create(dto: CreateTerritoryDto) {
    const existing = await this.prisma.territory.findUnique({ where: { name: dto.name } });
    if (existing) throw new ConflictException('Un territoire avec ce nom existe déjà');

    if (dto.ownerTeamId) {
      const team = await this.prisma.team.findUnique({ where: { id: dto.ownerTeamId } });
      if (!team) throw new NotFoundException('Équipe propriétaire introuvable');
    }

    return this.prisma.territory.create({
      data: {
        name: dto.name,
        ownerTeamId: dto.ownerTeamId,
        capturedAt: dto.ownerTeamId ? new Date() : null,
      },
    });
  }

  async update(id: string, dto: UpdateTerritoryDto) {
    const territory = await this.prisma.territory.findUnique({ where: { id } });
    if (!territory) throw new NotFoundException('Territoire introuvable');

    if (dto.name && dto.name !== territory.name) {
      const conflict = await this.prisma.territory.findUnique({ where: { name: dto.name } });
      if (conflict) throw new ConflictException('Un territoire avec ce nom existe déjà');
    }

    if (dto.ownerTeamId) {
      const team = await this.prisma.team.findUnique({ where: { id: dto.ownerTeamId } });
      if (!team) throw new NotFoundException('Équipe propriétaire introuvable');
    }

    return this.prisma.territory.update({
      where: { id },
      data: {
        ...dto,
        // Si le propriétaire change explicitement ici, on horodate la prise comme pour une conquête
        ...(dto.ownerTeamId && dto.ownerTeamId !== territory.ownerTeamId ? { capturedAt: new Date() } : {}),
      },
    });
  }

  async remove(id: string) {
    const ongoingRaid = await this.prisma.raid.findFirst({
      where: { territoryId: id, status: { in: ['PENDING', 'IN_PROGRESS'] } },
    });
    if (ongoingRaid) {
      throw new ConflictException('Impossible de supprimer : un raid est en cours sur ce territoire');
    }
    await this.prisma.territory.delete({ where: { id } });
    return { success: true };
  }
}