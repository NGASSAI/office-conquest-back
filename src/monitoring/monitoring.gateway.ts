import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Namespace dédié — seuls les comptes avec le rôle ADMIN, vérifié en base à la connexion, sont acceptés
@WebSocketGateway({ namespace: 'admin-monitoring', cors: true })
export class MonitoringGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger('MonitoringGateway');

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token as string;
      if (!token) throw new Error('Token manquant');

      const payload = this.jwt.verify(token, { secret: this.config.get('JWT_ACCESS_SECRET') });

      // Revérifié en base (pas seulement dans le JWT) — même principe que RolesGuard côté REST,
      // pour qu'un accès admin révoqué en cours de session soit immédiatement bloqué ici aussi.
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user || user.role !== 'ADMIN') throw new Error('Accès refusé');

      client.join('admins');
    } catch {
      this.logger.warn(`Connexion refusée au monitoring admin — ${client.id}`);
      client.disconnect(true);
    }
  }

  // Appelée par les autres services (raids, users, etc.) pour pousser un event live — uniquement aux admins
  emitEvent(eventName: string, payload: unknown) {
    this.server.to('admins').emit(eventName, payload);
  }
}