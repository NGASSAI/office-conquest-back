import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.use(helmet());
  app.use(cookieParser());

  app.enableCors({
    origin: config.get<string>('FRONTEND_URL'),
    credentials: true, // nécessaire pour le cookie httpOnly (remember me)
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,        // supprime les champs non déclarés dans les DTO
      forbidNonWhitelisted: true, // rejette la requête si un champ inattendu est envoyé
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  const port = config.get<number>('PORT') || 4000;
  await app.listen(port);
  console.log(`Backend démarré sur le port ${port}`);
}
bootstrap();
