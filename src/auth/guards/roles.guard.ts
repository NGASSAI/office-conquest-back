import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client'; // ✅ Utilise l'Enum généré par Prisma
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const userId = request.user?.userId;
    if (!userId) throw new ForbiddenException('Accès refusé');

    // On revérifie le rôle en base (pas seulement dans le JWT) pour éviter
    // qu'un ancien token conserve un rôle admin révoqué entre-temps
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !requiredRoles.includes(user.role)) {
      throw new ForbiddenException('Accès refusé');
    }
    return true;
  }
}
