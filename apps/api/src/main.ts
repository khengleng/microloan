import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // Suppress verbose NestJS logs that could expose internal details in production
    logger: process.env.NODE_ENV === 'production'
      ? ['error', 'warn']
      : ['log', 'error', 'warn', 'debug'],
  });

  // ── Security Headers (Helmet) ────────────────────────────────────────────
  // Protects against XSS, clickjacking, MIME sniffing, info disclosure, etc.
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
    crossOriginEmbedderPolicy: false, // Allow Railway health-check
    hsts: {
      maxAge: 31536000,        // 1 year
      includeSubDomains: true,
      preload: true,
    },
    xFrameOptions: { action: 'deny' },         // Clickjacking
    xContentTypeOptions: true,                        // MIME sniffing
    referrerPolicy: { policy: 'strict-origin' }, // Leaks prevention
    permittedCrossDomainPolicies: false,
  }));

  // ── Request body size limit ──────────────────────────────────────────────
  // Prevent large-payload DoS attacks (5MB max)
  app.use(require('express').json({ limit: '5mb' }));
  app.use(require('express').urlencoded({ limit: '5mb', extended: true }));

  // ── CORS ─────────────────────────────────────────────────────────────────
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (
        /\.railway\.app$/.test(origin) ||
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
    maxAge: 86400, // Pre-flight cache 24h
  });

  // ── Global prefix & pipes ────────────────────────────────────────────────
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
