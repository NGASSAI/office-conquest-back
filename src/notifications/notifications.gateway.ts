import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConnectedSocket,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';

interface AuthenticatedNotificationSocket extends Socket {
  data: { userId: string };
}

@WebSocketGateway({ namespace: 'notifications', cors: true })
export class NotificationsGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger('NotificationsGateway');

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: AuthenticatedNotificationSocket) {
    try {
      const token = client.handshake.auth?.token as string;
      if (!token) throw new Error('Token manquant');

      const payload = this.jwt.verify(token, { secret: this.config.get('JWT_ACCESS_SECRET') });
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, status: true },
      });
      if (!user || user.status !== 'ACTIVE') throw new Error('Compte inactif');

      client.data.userId = user.id;
      client.join(`user:${user.id}`);
    } catch {
      this.logger.warn(`Connexion notifications refusée — ${client.id}`);
      client.disconnect(true);
    }
  }

  @SubscribeMessage('notifications:subscribe')
  subscribe(@ConnectedSocket() client: AuthenticatedNotificationSocket) {
    if (!client.data.userId) return { success: false };
    return { success: true };
  }

  emitToUser(userId: string, event: string, payload: unknown) {
    this.server?.to(`user:${userId}`).emit(event, payload);
  }
}