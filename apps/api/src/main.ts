import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { loadRuntimeConfig } from './config/runtime-config';

async function bootstrap() {
  const runtime = loadRuntimeConfig();
  // Use NestExpressApplication so we can access the underlying express instance
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: runtime.isProduction
      ? ['error', 'warn']
      : ['log', 'error', 'warn', 'debug'],
  });

  // ── Trust Railway's proxy so req.ip is the real client IP ─────────────────
  // Without this, X-Forwarded-For is client-controlled and can spoof rate limits.
  app.set('trust proxy', 1);

  // ── Parse cookies (needed for HttpOnly auth tokens) ────────────────────────
  app.use(cookieParser());

  // ── Security Headers (Helmet) ──────────────────────────────────────────────
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    xFrameOptions: { action: 'deny' },
    xContentTypeOptions: true,
    referrerPolicy: { policy: 'strict-origin' },
    permittedCrossDomainPolicies: false,
  }));

  // ── Body size limit (DoS protection — 5 MB max) ───────────────────────────
  // NestExpressApplication exposes useBodyParser which uses
  // the already-bundled express parser — no separate require() needed.
  app.useBodyParser('json', { limit: '5mb' });
  app.useBodyParser('urlencoded', { limit: '5mb', extended: true });

  // ── CORS ───────────────────────────────────────────────────────────────────
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (runtime.corsOrigins.includes(origin)) {
        return callback(null, true);
      }
      callback(new Error(`CORS: origin ${origin} is not allowed`));
    },
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type,Accept,Authorization',
    maxAge: 86400,
  });

  // ── Validation ────────────────────────────────────────────────────────────
  app.setGlobalPrefix('v1');
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,  // Strip unknown properties
    forbidNonWhitelisted: true,  // Reject extra properties (prevents injection)
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  }));

  await app.listen(runtime.port);
  Logger.log(`API running on port ${runtime.port} with production safety checks enabled`);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
