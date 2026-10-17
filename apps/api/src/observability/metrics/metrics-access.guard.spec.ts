import { isPrivateAddress, metricsAccessAllowed } from './metrics-access.guard';
import { configuredPoolSize } from './metrics.service';

const TOKEN = 'a-scrape-token-of-sufficient-length';
const req = (
  headers: Record<string, string> = {},
  remoteAddress = '203.0.113.9',
) => ({ headers, socket: { remoteAddress } });

describe('metricsAccessAllowed', () => {
  it('is closed when nothing is configured', () => {
    expect(metricsAccessAllowed(req(), {})).toBe(false);
    expect(
      metricsAccessAllowed(req({ authorization: `Bearer ${TOKEN}` }), {}),
    ).toBe(false);
    expect(metricsAccessAllowed(req({}, '127.0.0.1'), {})).toBe(false);
  });

  it('accepts exactly the configured bearer token', () => {
    const env = { METRICS_BEARER_TOKEN: TOKEN };
    expect(
      metricsAccessAllowed(req({ authorization: `Bearer ${TOKEN}` }), env),
    ).toBe(true);
    expect(
      metricsAccessAllowed(req({ authorization: `bearer ${TOKEN}` }), env),
    ).toBe(true);
    expect(
      metricsAccessAllowed(req({ authorization: `Bearer ${TOKEN}x` }), env),
    ).toBe(false);
    expect(metricsAccessAllowed(req({ authorization: TOKEN }), env)).toBe(
      false,
    );
    expect(metricsAccessAllowed(req(), env)).toBe(false);
  });

  it('ignores a token too short to be a secret', () => {
    const env = { METRICS_BEARER_TOKEN: 'short' };
    expect(
      metricsAccessAllowed(req({ authorization: 'Bearer short' }), env),
    ).toBe(false);
  });

  it('allows direct private-network requests only when enabled, never forwarded ones', () => {
    const env = { METRICS_ALLOW_PRIVATE_NETWORK: 'true' };
    expect(metricsAccessAllowed(req({}, '10.1.2.3'), env)).toBe(true);
    expect(metricsAccessAllowed(req({}, '::ffff:192.168.1.4'), env)).toBe(true);
    expect(metricsAccessAllowed(req({}, '203.0.113.9'), env)).toBe(false);
    expect(
      metricsAccessAllowed(
        req({ 'x-forwarded-for': '203.0.113.9' }, '10.1.2.3'),
        env,
      ),
    ).toBe(false);
    expect(
      metricsAccessAllowed(req({ forwarded: 'for=1.2.3.4' }, '10.1.2.3'), env),
    ).toBe(false);
  });
});

describe('isPrivateAddress', () => {
  it.each([
    ['127.0.0.1', true],
    ['10.0.0.1', true],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['172.32.0.1', false],
    ['192.168.0.1', true],
    ['8.8.8.8', false],
    ['::1', true],
    ['fd00::1', true],
    ['2001:db8::1', false],
    ['not-an-ip', false],
    ['', false],
  ])('%s → %s', (addr, expected) => {
    expect(isPrivateAddress(addr)).toBe(expected);
  });
});

describe('configuredPoolSize', () => {
  it('reads connection_limit from the database URL', () => {
    expect(
      configuredPoolSize('postgresql://u@h:5432/db?connection_limit=7'),
    ).toBe(7);
  });
  it('falls back to Prisma’s default when not set', () => {
    expect(configuredPoolSize('postgresql://u@h:5432/db')).toBeGreaterThan(2);
    expect(configuredPoolSize('')).toBeGreaterThan(2);
  });
});
