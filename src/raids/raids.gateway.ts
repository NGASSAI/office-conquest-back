import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { RaidsService } from './raids.service';

interface AuthenticatedSocket extends Socket {
  data: { userId: string };
}

@WebSocketGateway({ namespace: 'raids', cors: true })
export class RaidsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger('RaidsGateway');

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly raidsService: RaidsService,
  ) {}

  handleConnection(client: AuthenticatedSocket) {
    try {
      const token = client.handshake.auth?.token as string;
      if (!token) throw new Error('Token manquant');
      const payload = this.jwt.verify(token, { secret: this.config.get('JWT_ACCESS_SECRET') });
      client.data.userId = payload.sub;
    } catch {
      this.logger.warn(`Connexion WebSocket refusée (token invalide) — ${client.id}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    // no-op — utile plus tard pour un statut "joueur déconnecté"
  }

  @SubscribeMessage('joinRaidRoom')
  async onJoinRaidRoom(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { raidId: string },
  ) {
    const raid = await this.raidsService.joinRaid(data.raidId, client.data.userId);
    client.join(`raid:${data.raidId}`);
    this.server.to(`raid:${data.raidId}`).emit('raidUpdate', raid);
    return raid;
  }

  @SubscribeMessage('submitRoundAnswer')
  async onSubmitAnswer(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { raidId: string; roundId: string; answerData: Record<string, unknown> },
  ) {
    const result = await this.raidsService.submitRoundAnswer(
      data.raidId,
      data.roundId,
      client.data.userId,
      data.answerData,
    );

    this.server.to(`raid:${data.raidId}`).emit('roundUpdate', {
      roundId: data.roundId,
      resultsData: result.resultsData,
    });

    if (result.roundEnded) {
      // Petite pause pour laisser les joueurs voir le résultat de la manche avant d'enchaîner
      const freshRaid = await this.raidsService.getRaidDetail(data.raidId, client.data.userId);
      this.server.to(`raid:${data.raidId}`).emit('raidUpdate', freshRaid);

      if (result.raidResult) {
        this.server.to(`raid:${data.raidId}`).emit('raidEnded', result.raidResult);
      }
    }

    return result;
  }
}