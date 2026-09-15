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
  @WebSocketServer() server: Server;
  private readonly logger = new Logger('RaidsGateway');

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly raidsService: RaidsService,
  ) {}

  // Authentification obligatoire à la connexion — le socket transporte le même access token que l'API REST
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
    // no-op pour l'instant — utile pour un futur "joueur déconnecté" dans le raid
  }

  @SubscribeMessage('joinRaidRoom')
  async onJoinRaidRoom(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { raidId: string },
  ) {
    // La légitimité (appartenance à l'équipe) est revalidée côté service, pas seulement côté socket
    const raid = await this.raidsService.joinRaid(data.raidId, client.data.userId);
    client.join(`raid:${data.raidId}`);
    this.server.to(`raid:${data.raidId}`).emit('raidUpdate', raid);
    return raid;
  }

  @SubscribeMessage('submitRoundScore')
  async onSubmitScore(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { raidId: string; roundId: string; score: number },
  ) {
    if (data.score < 0 || data.score > 100) return; // borne défensive côté gateway aussi
    const results = await this.raidsService.submitRoundScore(
      data.raidId,
      data.roundId,
      client.data.userId,
      data.score,
    );
    this.server.to(`raid:${data.raidId}`).emit('roundUpdate', results);
  }

  // Émission serveur→client quand une manche/raid se termine (appelée par RaidsService si besoin)
  broadcastRaidEnded(raidId: string, result: unknown) {
    this.server.to(`raid:${raidId}`).emit('raidEnded', result);
  }
}
