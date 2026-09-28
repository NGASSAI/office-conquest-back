import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

function normalizeExceptionMessage(value: unknown): string | string[] {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const normalized = normalizeExceptionMessage(item);
      return Array.isArray(normalized) ? normalized : [normalized];
    });
  }
  if (value && typeof value === 'object' && 'message' in value) {
    return normalizeExceptionMessage(value.message);
  }
  return 'Erreur interne du serveur';
}

// Filtre global : ne jamais laisser fuiter une stack trace ou un détail interne au client
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse = isHttpException
      ? exception.getResponse()
      : 'Erreur interne du serveur';
    const message = normalizeExceptionMessage(exceptionResponse);

    if (!isHttpException) {
      // On log la vraie erreur côté serveur uniquement (jamais renvoyée au client)
      this.logger.error(exception);
    }

    response.status(status).json({
      statusCode: status,
      path: request.url,
      timestamp: new Date().toISOString(),
      message,
    });
  }
}
