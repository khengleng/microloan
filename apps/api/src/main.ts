import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

// ── Required secrets guard — fail fast at startup, never use insecure fallbacks ──
const REQUIRED_SECRETS = [
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'SETUP_SECRET',
] as const;

for (const key of REQUIRED_SECRETS) {
  if (!process.env[key]) {
    console.error(`FATAL: Required environment variable "${key}" is not set. Refusing to start.`);
    process.exit(1);
  }
}

async function bootstrap() {
  // Use NestExpressApplication so we can access the underlying express instance
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: process.env.NODE_ENV === 'production'
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
      if (
        /\.railway\.app$/.test(origin) ||
        /\.cambobia\.com$/.test(origin) ||
        /^http:\/\/localhost(:\d+)?$/.test(origin) ||
        /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)
      ) {
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

  const port = process.env.PORT || 3001;
  await app.listen(port);
  Logger.log(`🔐 API running on port ${port} with security hardening enabled`);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
