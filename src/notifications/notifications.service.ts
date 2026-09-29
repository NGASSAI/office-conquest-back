import { Injectable } from '@nestjs/common';
import { UserNotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from './notifications.gateway';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
  ) {}

  async notifyUser(
    userId: string,
    type: UserNotificationType,
    title: string,
    message: string,
    targetId: string,
  ) {
    const notification = await this.prisma.userNotification.create({
      data: { userId, type, title, message, targetId },
    });
    this.gateway.emitToUser(userId, 'notification:new', notification);
    return notification;
  }

  async notifyTeam(
    teamId: string,
    type: UserNotificationType,
    title: string,
    message: string,
    targetId: string,
  ) {
    const members = await this.prisma.user.findMany({
      where: { teamId, status: 'ACTIVE' },
      select: { id: true },
    });
    await Promise.all(members.map((member) =>
      this.notifyUser(member.id, type, title, message, targetId),
    ));
  }

  listUnread(userId: string) {
    return this.prisma.userNotification.findMany({
      where: { userId, readAt: null },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
  }

  async markRead(userId: string, notificationId: string) {
    const notification = await this.prisma.userNotification.findFirst({
      where: { id: notificationId, userId, readAt: null },
      select: { id: true },
    });
    if (!notification) return { success: true };

    await this.prisma.userNotification.update({
      where: { id: notification.id },
      data: { readAt: new Date() },
    });
    this.gateway.emitToUser(userId, 'notification:removed', { id: notification.id });
    return { success: true };
  }

  async markTargetRead(userId: string, targetId: string) {
    const notifications = await this.prisma.userNotification.findMany({
      where: { userId, targetId, readAt: null },
      select: { id: true },
    });
    if (notifications.length === 0) return;

    await this.prisma.userNotification.updateMany({
      where: { id: { in: notifications.map((notification) => notification.id) } },
      data: { readAt: new Date() },
    });
    for (const notification of notifications) {
      this.gateway.emitToUser(userId, 'notification:removed', { id: notification.id });
    }
  }

  async markTargetReadForTarget(targetId: string) {
    const notifications = await this.prisma.userNotification.findMany({
      where: { targetId, readAt: null },
      select: { id: true, userId: true },
    });
    if (notifications.length === 0) return;

    await this.prisma.userNotification.updateMany({
      where: { id: { in: notifications.map((notification) => notification.id) } },
      data: { readAt: new Date() },
    });
    for (const userId of new Set(notifications.map((notification) => notification.userId))) {
      this.gateway.emitToUser(userId, 'notification:removed', { targetId });
    }
  }
}