import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamAdminDto } from './dto/update-team-admin.dto';

@Injectable()
export class TeamsService {
  constructor(private readonly prisma: PrismaService) {}

  async listWithStats() {
    return this.prisma.team.findMany({
      include: { _count: { select: { members: true, territories: true } } },
      orderBy: { energy: 'desc' },
    });
  }

  async getDetails(id: string) {
    const team = await this.prisma.team.findUnique({
      where: { id },
      include: {
        territories: true,
        members: { select: { id: true, pseudo: true, avatar: true } },
      },
    });
    if (!team) throw new NotFoundException('Équipe introuvable');
    return team;
  }

  async addEnergy(teamId: string, amount: number) {
    return this.prisma.team.update({ where: { id: teamId }, data: { energy: { increment: amount } } });
  }

  async resetEnergy(teamId: string) {
    return this.prisma.team.update({ where: { id: teamId }, data: { energy: 0 } });
  }

  // --- Admin ---

  async create(dto: CreateTeamDto) {
    const existing = await this.prisma.team.findUnique({ where: { name: dto.name } });
    if (existing) throw new ConflictException('Une équipe avec ce nom existe déjà');
    return this.prisma.team.create({ data: dto });
  }

  async update(id: string, dto: UpdateTeamAdminDto) {
    const team = await this.prisma.team.findUnique({ where: { id } });
    if (!team) throw new NotFoundException('Équipe introuvable');

    if (dto.name && dto.name !== team.name) {
      const conflict = await this.prisma.team.findUnique({ where: { name: dto.name } });
      if (conflict) throw new ConflictException('Une équipe avec ce nom existe déjà');
    }

    return this.prisma.team.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    const membersCount = await this.prisma.user.count({ where: { teamId: id } });
    if (membersCount > 0) {
      throw new BadRequestException(
        `Impossible de supprimer : ${membersCount} joueur(s) encore dans cette équipe`,
      );
    }
    const territoriesCount = await this.prisma.territory.count({ where: { ownerTeamId: id } });
    if (territoriesCount > 0) {
      throw new BadRequestException(
        `Impossible de supprimer : ${territoriesCount} territoire(s) encore possédé(s) par cette équipe`,
      );
    }
    await this.prisma.team.delete({ where: { id } });
    return { success: true };
  }
}