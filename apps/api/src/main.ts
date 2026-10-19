import { NestFactory, HttpAdapterHost } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { loadRuntimeConfig } from './config/runtime-config';
import { operationalConfig } from './config/operational-config';
import { initSentry } from './observability/sentry';
import { SentryExceptionFilter } from './observability/sentry-exception.filter';

async function bootstrap() {
  // Initialise error tracking before anything else (no-op without SENTRY_DSN).
  const sentryOn = initSentry();
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
  // Google Identity Services allowances, applied only when Google sign-in is
  // configured — an unconfigured deployment keeps the strict original policy:
  //   script-src  accounts.google.com  — the GIS client library
  //   frame-src   accounts.google.com  — the One Tap / consent iframe
  //   connect-src accounts.google.com  — token and certificate fetches
  //
  // NOTE: this policy rides on API responses, which are JSON. The sign-in page
  // is served by the Next.js app, which currently sends no CSP of its own, so
  // the browser loads GIS without needing anything here. These directives
  // matter only if the API ever serves HTML — and if you add a CSP to the web
  // app, the same three origins must be allowed THERE or the button will not
  // render.
  const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID?.trim());
  const GOOGLE_ORIGINS = [
    'https://accounts.google.com',
    'https://www.gstatic.com',
  ];
  const allowGoogle = (base: string[]) =>
    googleEnabled ? [...base, ...GOOGLE_ORIGINS] : base;

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: allowGoogle(["'self'"]),
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: allowGoogle(["'self'"]),
          frameSrc: googleEnabled ? GOOGLE_ORIGINS : ["'none'"],
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
    }),
  );

  // ── Body size limit (DoS protection — API_BODY_LIMIT, default 5 MB) ───────
  // NestExpressApplication exposes useBodyParser which uses
  // the already-bundled express parser — no separate require() needed.
  const { bodyLimit } = operationalConfig();
  app.useBodyParser('json', { limit: bodyLimit });
  app.useBodyParser('urlencoded', { limit: bodyLimit, extended: true });

  // ── CORS ───────────────────────────────────────────────────────────────────
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (runtime.corsOrigins.includes(origin)) {
        return callback(null, true);
      }
      // Refuse without an error: the response simply carries no CORS
      // headers, so the browser blocks it. Passing an Error here surfaced as
      // a 500 for every disallowed preflight.
      callback(null, false);
    },
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders:
      'Content-Type,Accept,Authorization,Idempotency-Key,X-Service-Key',
    maxAge: 86400,
  });

  // ── Validation ────────────────────────────────────────────────────────────
  app.setGlobalPrefix('v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Strip unknown properties
      forbidNonWhitelisted: true, // Reject extra properties (prevents injection)
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Report unhandled/5xx exceptions to Sentry (no-op when disabled).
  const httpAdapter = app.get(HttpAdapterHost).httpAdapter;
  app.useGlobalFilters(new SentryExceptionFilter(httpAdapter));

  if (runtime.isProduction && !runtime.webProxySecret) {
    Logger.warn(
      'WEB_PROXY_SECRET is not set: X-Client-IP from the web server is ignored, ' +
        'so throttling and audit see the web server address for proxied traffic.',
    );
  }
  // On SIGTERM (every Railway redeploy) run the modules' shutdown hooks —
  // onModuleDestroy disconnects Prisma and stops the cron jobs — instead of
  // the process dying with connections and job claims still open.
  app.enableShutdownHooks();

  await app.listen(runtime.port);
  Logger.log(
    `API running on port ${runtime.port} with production safety checks enabled` +
      (sentryOn ? ' (Sentry active)' : ''),
  );
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
