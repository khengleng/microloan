import { Controller, Post } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import {
  ThrottlerModule,
  ThrottlerStorageService,
  getStorageToken,
} from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from 'nestjs-throttler-storage-redis';
import { throttlerOptions } from './throttler-options';
import {
  ThrottleIdentity,
  UserAwareThrottlerGuard,
} from './user-aware-throttler.guard';
import { Public } from '../auth/auth-scope.decorator';
import { borrowerJwtSecret } from '../borrower-portal/borrower-jwt';

const ACCESS = 'test-access-secret-that-is-long-enough-123';
const PROXY = 'p'.repeat(40);

describe('ThrottlerModule storage wiring', () => {
  async function storageFor(redisUrl: string | undefined) {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRootAsync({
          useFactory: () => throttlerOptions(redisUrl),
        }),
      ],
    }).compile();
    return { moduleRef, storage: moduleRef.get(getStorageToken()) };
  }

  it('uses the Redis storage when REDIS_URL is set', async () => {
    // Nothing listens on port 1; the client is torn down before it matters.
    const { moduleRef, storage } = await storageFor('redis://127.0.0.1:1');
    (storage as any).redis.on('error', () => undefined);
    expect(storage).toBeInstanceOf(ThrottlerStorageRedisService);
    await moduleRef.close();
    (storage as any).redis.disconnect(false);
  });

  it('counts in memory only without REDIS_URL', async () => {
    const { moduleRef, storage } = await storageFor(undefined);
    expect(storage).toBeInstanceOf(ThrottlerStorageService);
    expect(storage).not.toBeInstanceOf(ThrottlerStorageRedisService);
    await moduleRef.close();
  });
});

@Controller('t')
class Routes {
  @Public()
  @ThrottleIdentity('email')
  @Post('login')
  login() {}

  @Post('private')
  privateRoute() {}
}

describe('UserAwareThrottlerGuard tracker', () => {
  const saved = { ...process.env };
  let guard: UserAwareThrottlerGuard;
  const jwt = new JwtService();

  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = ACCESS;
    process.env.WEB_PROXY_SECRET = PROXY;
    guard = new UserAwareThrottlerGuard(
      { throttlers: [{ name: 'default', ttl: 1000, limit: 10 }] },
      new ThrottlerStorageService(),
      new Reflector(),
    );
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  const ctx = (handler: keyof Routes) =>
    ({
      getHandler: () => Routes.prototype[handler],
      getClass: () => Routes,
    }) as any;
  const viaWeb = (extra: Record<string, string> = {}) => ({
    ip: '100.64.0.2', // the web server, as the API sees it
    headers: {
      'x-web-proxy-secret': PROXY,
      'x-client-ip': '198.51.100.20',
      ...extra,
    },
  });
  const tracker = (req: any, handler: keyof Routes) =>
    (guard as any).getTracker(req, ctx(handler));

  it('keys an authenticated request by user id', async () => {
    const token = jwt.sign({ sub: 'user-1', email: 'a@b.co', role: 'ADMIN' }, { secret: ACCESS });
    await expect(
      tracker(viaWeb({ authorization: `Bearer ${token}` }), 'privateRoute'),
    ).resolves.toBe('user:user-1');
  });

  it('reads the access_token cookie too', async () => {
    const token = jwt.sign({ sub: 'user-2', email: 'a@b.co', role: 'ADMIN' }, { secret: ACCESS });
    await expect(
      tracker({ ...viaWeb(), cookies: { access_token: token } }, 'privateRoute'),
    ).resolves.toBe('user:user-2');
  });

  it('keys a borrower session by borrower id', async () => {
    const token = jwt.sign(
      { sub: 'b-1', typ: 'borrower', tenantId: 't' },
      { secret: borrowerJwtSecret() },
    );
    await expect(
      tracker(viaWeb({ authorization: `Bearer ${token}` }), 'privateRoute'),
    ).resolves.toBe('borrower:b-1');
  });

  it('falls back to the client IP for a forged token', async () => {
    const forged = jwt.sign({ sub: 'victim' }, { secret: 'not-the-secret-at-all-000000000000' });
    await expect(
      tracker(viaWeb({ authorization: `Bearer ${forged}` }), 'privateRoute'),
    ).resolves.toBe('ip:198.51.100.20');
  });

  it('does not treat an MFA challenge token as a session', async () => {
    const challenge = jwt.sign({ sub: 'user-1', mfaChallenge: true }, { secret: ACCESS });
    await expect(
      tracker(viaWeb({ authorization: `Bearer ${challenge}` }), 'privateRoute'),
    ).resolves.toBe('ip:198.51.100.20');
  });

  it('keys public routes by client IP even with a valid token', async () => {
    const token = jwt.sign({ sub: 'user-1', email: 'a@b.co', role: 'ADMIN' }, { secret: ACCESS });
    await expect(
      tracker(viaWeb({ authorization: `Bearer ${token}` }), 'login'),
    ).resolves.toBe('ip:198.51.100.20');
  });

  it('uses req.ip when the web proxy secret is wrong', async () => {
    await expect(
      tracker(viaWeb({ 'x-web-proxy-secret': 'x'.repeat(40) }), 'login'),
    ).resolves.toBe('ip:100.64.0.2');
  });

  it('normalises the identity a credential route targets', () => {
    expect(guard.identityOf({ body: { email: ' A@B.co ' } }, 'email')).toBe('a@b.co');
    expect(guard.identityOf({ body: { phone: '+855 12-345-678' } }, 'phone')).toBe('85512345678');
    expect(guard.identityOf({ body: {} }, 'email')).toBeNull();
    const challenge = jwt.sign({ sub: 'user-9', mfaChallenge: true }, { secret: ACCESS });
    expect(guard.identityOf({ body: { mfaToken: challenge } }, 'mfa')).toBe('user-9');
    expect(guard.identityOf({ body: { mfaToken: 'garbage' } }, 'mfa')).toBeNull();
  });

  describe('per-IP and per-email budgets on login', () => {
    const run = async (ip: string, email: string) => {
      const req = viaWeb({ 'x-client-ip': ip });
      (req as any).body = { email, password: 'x' };
      const res = { header: () => undefined };
      const context = {
        ...ctx('login'),
        switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
      };
      return guard.canActivate(context as any);
    };

    beforeEach(async () => {
      guard = new UserAwareThrottlerGuard(
        { throttlers: [{ name: 'default', ttl: 60_000, limit: 3 }] },
        new ThrottlerStorageService(),
        new Reflector(),
      );
      await guard.onModuleInit();
    });

    it('one address cannot exhaust another address budget', async () => {
      for (let i = 0; i < 3; i++) await run('198.51.100.1', `u${i}@x.co`);
      await expect(run('198.51.100.1', 'other@x.co')).rejects.toThrow(/Too Many Requests/i);
      // A different user behind a different address is unaffected.
      await expect(run('198.51.100.2', 'someone@x.co')).resolves.toBe(true);
    });

    it('one email cannot be hammered from many addresses', async () => {
      for (let i = 0; i < 3; i++) await run(`198.51.100.${10 + i}`, 'victim@x.co');
      await expect(run('198.51.100.50', 'Victim@x.co')).rejects.toThrow(/Too Many Requests/i);
      await expect(run('198.51.100.51', 'other@x.co')).resolves.toBe(true);
    });
  });
});
