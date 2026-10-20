import { createServer, IncomingMessage, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  isPublicAddress,
  pinnedLookup,
  postToPinned,
  postToPublicEndpoint,
  resolvePublicEndpoint,
  UnsafeEndpointError,
} from './outbound-http';

/**
 * Outbound requests to administrator-supplied URLs (D-144, D-145): only
 * global unicast addresses, in any spelling, and the connection pinned to
 * the one vetted resolution.
 */
describe('outbound HTTP to administrator-supplied endpoints', () => {
  describe('address classification', () => {
    const notPublic = [
      // IPv4 special-purpose ranges
      '0.0.0.0',
      '0.1.2.3',
      '10.0.0.5',
      '100.64.0.1',
      '100.127.255.254',
      '127.0.0.1',
      '127.255.255.254',
      '169.254.169.254',
      '172.16.0.1',
      '172.31.255.255',
      '192.0.0.8',
      '192.0.2.1',
      '192.88.99.1',
      '192.168.1.1',
      '198.18.0.1',
      '198.19.255.255',
      '198.51.100.7',
      '203.0.113.9',
      '224.0.0.1',
      '239.255.255.250',
      '240.0.0.1',
      '255.255.255.255',
      // IPv6 loopback, unspecified, unique-local, link-local, multicast
      '::1',
      '::',
      '0:0:0:0:0:0:0:1',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      'febf::1',
      'ff02::1',
      // IPv4-mapped, every spelling
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '::FFFF:7F00:0001',
      '0:0:0:0:0:ffff:7f00:1',
      '0000:0000:0000:0000:0000:ffff:127.0.0.1',
      '::ffff:a9fe:a9fe', // 169.254.169.254
      '::ffff:8.8.8.8', // even a public IPv4 is refused in mapped form
      // IPv4-compatible (deprecated) and IPv4-translated
      '::7f00:1',
      '::127.0.0.1',
      '::ffff:0:7f00:1',
      // NAT64
      '64:ff9b::7f00:1',
      '64:ff9b::a00:5',
      '64:ff9b::127.0.0.1',
      '64:ff9b:1::a00:5',
      // 6to4 and Teredo
      '2002:7f00:1::1',
      '2002:a00:5::',
      '2001:0:4136:e378:8000:63bf:3fff:fdd2',
      // documentation
      '2001:db8::1',
      '3fff::1',
      // bracketed forms and garbage
      '[::1]',
      '[::ffff:7f00:1]',
      'localhost',
      '',
      '127.1',
      '0x7f000001',
      '2130706433',
    ];
    it.each(notPublic)('%s is not public', (ip) => {
      expect(isPublicAddress(ip)).toBe(false);
    });

    const publicAddresses = [
      '8.8.8.8',
      '1.1.1.1',
      '93.184.215.14',
      '100.63.255.255',
      '100.128.0.1',
      '172.15.255.255',
      '172.32.0.1',
      '2606:4700:4700::1111',
      '2001:4860:4860::8888',
      '[2a00:1450:4001::200e]',
    ];
    it.each(publicAddresses)('%s is public', (ip) => {
      expect(isPublicAddress(ip)).toBe(true);
    });
  });

  describe('resolving an endpoint', () => {
    const never = jest.fn(() => Promise.reject(new Error('no DNS here')));

    it.each([
      'https://127.0.0.1/hook',
      'https://2130706433/hook',
      'https://0x7f000001/hook',
      'https://0177.0.0.1/hook',
      'https://127.1/hook',
      'https://[::1]/hook',
      'https://[::ffff:7f00:1]/hook',
      'https://[::ffff:127.0.0.1]/hook',
      'https://[0:0:0:0:0:ffff:7f00:1]/hook',
      'https://[::7f00:1]/hook',
      'https://[64:ff9b::7f00:1]/hook',
      'https://[2002:7f00:1::]/hook',
      'https://169.254.169.254/latest/meta-data',
      'https://[::ffff:a9fe:a9fe]/latest/meta-data',
    ])('refuses the literal %s without asking DNS', async (raw) => {
      await expect(
        resolvePublicEndpoint(new URL(raw), never),
      ).rejects.toBeInstanceOf(UnsafeEndpointError);
      expect(never).not.toHaveBeenCalled();
    });

    it('refuses a name when any of its answers is internal', async () => {
      const mixed = jest.fn(() =>
        Promise.resolve([
          { address: '93.184.215.14', family: 4 },
          { address: '::ffff:7f00:1', family: 6 },
        ]),
      );
      await expect(
        resolvePublicEndpoint(new URL('https://hooks.example.org/x'), mixed),
      ).rejects.toThrow(/public internet/);
    });

    it('refuses a name that does not resolve', async () => {
      await expect(
        resolvePublicEndpoint(new URL('https://nowhere.invalid/x'), never),
      ).rejects.toThrow(/does not resolve/);
    });

    it('returns the vetted answer, asking DNS exactly once', async () => {
      const dns = jest.fn(() =>
        Promise.resolve([{ address: '2606:4700:4700::1111', family: 6 }]),
      );
      await expect(
        resolvePublicEndpoint(new URL('https://hooks.example.org/x'), dns),
      ).resolves.toEqual({ address: '2606:4700:4700::1111', family: 6 });
      expect(dns).toHaveBeenCalledTimes(1);
    });

    it('a delivery that resolves to an internal address is never sent', async () => {
      // The rebinding case: the name was public when registered, and now
      // answers with the metadata service.
      const rebound = jest.fn(() =>
        Promise.resolve([{ address: '169.254.169.254', family: 4 }]),
      );
      await expect(
        postToPublicEndpoint(new URL('https://hooks.example.org/x'), {
          headers: {},
          body: '{}',
          timeoutMs: 1000,
          resolver: rebound,
        }),
      ).rejects.toBeInstanceOf(UnsafeEndpointError);
      expect(rebound).toHaveBeenCalledTimes(1);
    });
  });

  describe('pinning the connection', () => {
    type Lookup = (
      host: string,
      options: object,
      callback: (...args: unknown[]) => void,
    ) => void;
    it('answers every lookup with the vetted address, in both callback forms', () => {
      const lookup = pinnedLookup({
        address: '8.8.8.8',
        family: 4,
      }) as unknown as Lookup;
      const single = jest.fn();
      lookup('anything.example', {}, single);
      expect(single).toHaveBeenCalledWith(null, '8.8.8.8', 4);
      const all = jest.fn();
      lookup('anything.example', { all: true }, all);
      expect(all).toHaveBeenCalledWith(null, [
        { address: '8.8.8.8', family: 4 },
      ]);
      // A target that is not public is refused even here.
      const refused = jest.fn();
      (pinnedLookup({ address: '10.0.0.1', family: 4 }) as unknown as Lookup)(
        'x',
        {},
        refused,
      );
      expect(refused.mock.calls[0][0]).toBeInstanceOf(UnsafeEndpointError);
    });

    describe('against a local receiver', () => {
      let server: Server;
      let port: number;
      const seen: { host?: string; body: string }[] = [];
      beforeAll(async () => {
        server = createServer((req: IncomingMessage, res) => {
          let body = '';
          req.on('data', (c) => (body += c));
          req.on('end', () => {
            seen.push({ host: req.headers.host, body });
            res.statusCode = 204;
            res.end();
          });
        });
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
        port = (server.address() as AddressInfo).port;
      });
      afterAll(() => new Promise((r) => server.close(r)));

      it('connects to the pinned address, never resolving the name again, and keeps the Host header', async () => {
        // ".invalid" can never resolve (RFC 6761): the request only arrives
        // because the connection goes to the pinned address. (127.0.0.1 is
        // allowed here explicitly — the development escape hatch — because a
        // test cannot listen on a public address.)
        const res = await postToPinned(
          new URL(`http://rebind.invalid:${port}/hook`),
          { address: '127.0.0.1', family: 4, allowPrivate: true },
          { headers: { 'X-Test': '1' }, body: '{"a":1}', timeoutMs: 2000 },
        );
        expect(res.status).toBe(204);
        expect(seen.pop()).toEqual({
          host: `rebind.invalid:${port}`,
          body: '{"a":1}',
        });
      });

      it('refuses the same local receiver when private networks are not allowed', async () => {
        await expect(
          postToPublicEndpoint(new URL(`http://127.0.0.1:${port}/hook`), {
            headers: {},
            body: '{}',
            timeoutMs: 2000,
          }),
        ).rejects.toBeInstanceOf(UnsafeEndpointError);
        expect(seen).toEqual([]);
      });
    });
  });
});
