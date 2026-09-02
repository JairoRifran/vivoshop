import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ENV, type AppEnv } from './config/env';
import { CorsIoAdapter } from './infrastructure/realtime/io-adapter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const env = app.get<AppEnv>(ENV);
  const logger = new Logger('Bootstrap');

  if (env.TRUST_PROXY) {
    // Behind Railway, Fly or any load balancer, every request arrives from the
    // proxy. Without this, `request.ip` is the proxy's address and the rate
    // limiter throttles the whole internet as if it were one visitor.
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
  }

  // API-only service: no cookies, no sessions, no CSRF surface. The CSP
  // defaults helmet applies to HTML do not apply to JSON, so they are off.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));

  app.enableCors({
    origin: env.corsOrigins,
    credentials: false,
    // PUT está por las subidas de imágenes: con `STORAGE_PROVIDER=local` los
    // bytes van del navegador a esta API, y `Content-Type: image/webp` obliga
    // al navegador a preguntar antes con OPTIONS.
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Socket.IO does its own CORS handshake and does not inherit the setting
  // above. Same allowlist, declared once more where the adapter can see it.
  app.useWebSocketAdapter(new CorsIoAdapter(app, env.corsOrigins));

  // Validation is per-route through `zodPipe`, using the same schemas the web
  // app validates its forms with. No global class-validator pipe on purpose.
  app.enableShutdownHooks();

  await app.listen(env.API_PORT, '0.0.0.0');

  logger.log(`Vivo API en http://localhost:${env.API_PORT}`);
  logger.log(`Datos: ${env.DATA_DRIVER} · Cache: ${env.CACHE_DRIVER}`);
  logger.log(`Streaming: ${env.STREAMING_PROVIDER} · Realtime: ws://localhost:${env.API_PORT}/realtime`);
  logger.log(`Origenes permitidos: ${env.corsOrigins.join(', ')}`);
}

void bootstrap();
