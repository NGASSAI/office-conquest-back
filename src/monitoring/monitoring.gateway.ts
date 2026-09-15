import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

// Namespace dédié pour ne pousser les events qu'aux admins connectés
@WebSocketGateway({ namespace: 'admin-monitoring', cors: true })
export class MonitoringGateway implements OnGatewayConnection {
  @WebSocketServer() server: Server;

  handleConnection(client: Socket) {
    // TODO: vérifier le rôle ADMIN via le token avant d'accepter la connexion
  }

  // Appelée par les autres services (raids, users, etc.) pour pousser un event live
  emitEvent(eventName: string, payload: unknown) {
    this.server.emit(eventName, payload);
  }
}
