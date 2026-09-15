import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { envValidationSchema } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { TeamsModule } from './teams/teams.module';
import { TerritoriesModule } from './territories/territories.module';
import { ChallengesModule } from './challenges/challenges.module';
import { RaidsModule } from './raids/raids.module';
import { DuelsModule } from './duels/duels.module';
import { AdminModule } from './admin/admin.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema: envValidationSchema }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]), // limite globale par IP
    PrismaModule,
    AuthModule,
    UsersModule,
    TeamsModule,
    TerritoriesModule,
    ChallengesModule,
    RaidsModule,
    DuelsModule,
    AdminModule,
    MonitoringModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },  // anti brute-force / DoS global
    { provide: APP_GUARD, useClass: JwtAuthGuard },    // auth obligatoire par défaut
    { provide: APP_GUARD, useClass: RolesGuard },      // contrôle des rôles (admin)
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
})
export class AppModule {}
