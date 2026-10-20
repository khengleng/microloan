import { lookup as dnsLookup } from 'node:dns/promises';
import * as http from 'node:http';
import * as https from 'node:https';
import { BlockList, isIP } from 'node:net';
import type { LookupFunction } from 'node:net';

/**
 * Outbound HTTP to addresses a tenant administrator supplies (webhook
 * endpoints, alternative-data providers) — DECISIONS D-144, D-145.
 *
 * Two rules:
 *
 *  1. Only global unicast addresses are reachable. IPv4 special-purpose
 *     ranges (private, loopback, link-local, CGNAT, benchmarking,
 *     documentation, multicast, reserved…) are refused; IPv6 must lie in
 *     2000::/3 and outside its special-purpose blocks. Every IPv6 form that
 *     embeds an IPv4 address — IPv4-mapped (::ffff:7f00:1, in any spelling),
 *     IPv4-compatible (::7f00:1), IPv4-translated, NAT64 (64:ff9b::/96,
 *     64:ff9b:1::/48), 6to4 (2002::/16), Teredo (2001::/32) — is refused
 *     outright rather than decoded, so no spelling of an internal address
 *     slips through. Classification uses node:net's BlockList, which parses
 *     the address itself; nothing here compares strings.
 *
 *  2. The name is resolved once, every answer must be public, and the
 *     connection goes to that pinned answer: the request's DNS lookup is
 *     replaced by one that returns it. A second resolution — the gap DNS
 *     rebinding uses — never happens. The URL's host name is still what TLS
 *     verifies the certificate against (SNI) and what the Host header says.
 */

const V4_NOT_PUBLIC: [string, number][] = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (cloud metadata)
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, and 255.255.255.255 broadcast
];

/** IPv6 global unicast. Everything outside it (::/8 forms, fc00::/7, fe80::/10, ff00::/8, 64:ff9b::/96…) is refused. */
const V6_GLOBAL: [string, number][] = [['2000::', 3]];

const V6_NOT_PUBLIC: [string, number][] = [
  ['2001::', 23], // IETF protocol assignments, Teredo (2001::/32), ORCHID
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4: embeds an IPv4 address
  ['3fff::', 20], // documentation
];

function blockList(entries: [string, number][], type: 'ipv4' | 'ipv6') {
  const list = new BlockList();
  for (const [net, prefix] of entries) list.addSubnet(net, prefix, type);
  return list;
}

const v4NotPublic = blockList(V4_NOT_PUBLIC, 'ipv4');
const v6Global = blockList(V6_GLOBAL, 'ipv6');
const v6NotPublic = blockList(V6_NOT_PUBLIC, 'ipv6');

/** True only for a global unicast address. Anything unparseable is not public. */
export function isPublicAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, '');
  switch (isIP(ip)) {
    case 4:
      return !v4NotPublic.check(ip, 'ipv4');
    case 6:
      return v6Global.check(ip, 'ipv6') && !v6NotPublic.check(ip, 'ipv6');
    default:
      return false;
  }
}

/** Why an endpoint was refused; the message is safe to show the administrator. */
export class UnsafeEndpointError extends Error {}

export interface ResolvedEndpoint {
  address: string;
  family: 4 | 6;
  /** Development only: the target was not vetted (private networks allowed). */
  allowPrivate?: boolean;
}

export type Resolver = (
  host: string,
) => Promise<{ address: string; family: number }[]>;

const systemResolver: Resolver = (host) =>
  dnsLookup(host, { all: true, verbatim: true });

/**
 * Resolve the URL's host once and vet every answer. Returns the address to
 * connect to. An IP literal is vetted as it is (the URL parser has already
 * turned 2130706433, 0x7f.1 and similar into dotted form).
 */
export async function resolvePublicEndpoint(
  url: URL,
  resolver: Resolver = systemResolver,
): Promise<ResolvedEndpoint> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const literal = isIP(host);
  const answers = literal
    ? [{ address: host, family: literal }]
    : await resolver(host).catch(() => []);
  if (!answers.length)
    throw new UnsafeEndpointError(`${host} does not resolve.`);
  if (answers.some((a) => !isPublicAddress(a.address)))
    throw new UnsafeEndpointError(
      'The endpoint must be on the public internet.',
    );
  const first = answers[0];
  return { address: first.address, family: first.family === 6 ? 6 : 4 };
}

/**
 * A DNS lookup that answers every question with the vetted address — the
 * connection cannot go anywhere else, whatever the name resolves to by then.
 */
export function pinnedLookup(target: ResolvedEndpoint): LookupFunction {
  return ((
    _hostname: string,
    options: { all?: boolean } | number | undefined,
    callback: (...args: unknown[]) => void,
  ) => {
    if (!isPublicAddress(target.address) && !target.allowPrivate) {
      callback(
        new UnsafeEndpointError('The endpoint must be on the public internet.'),
      );
      return;
    }
    if (typeof options === 'object' && options?.all)
      callback(null, [{ address: target.address, family: target.family }]);
    else callback(null, target.address, target.family);
  }) as unknown as LookupFunction;
}

export interface PostResult {
  status: number;
}

/**
 * POST `body` to `url`, connecting only to `target` (from
 * resolvePublicEndpoint). No redirect is followed and the response body is
 * discarded.
 */
export function postToPinned(
  url: URL,
  target: ResolvedEndpoint,
  opts: { headers: Record<string, string>; body: string; timeoutMs: number },
): Promise<PostResult> {
  const transport = url.protocol === 'https:' ? https : http;
  return new Promise<PostResult>((resolve, reject) => {
    const req = transport.request(
      url,
      {
        method: 'POST',
        headers: {
          ...opts.headers,
          'Content-Length': String(Buffer.byteLength(opts.body)),
        },
        lookup: pinnedLookup(target),
        // A fresh connection per request: a pooled socket could outlive the
        // vetting it was opened under.
        agent: false,
        signal: AbortSignal.timeout(opts.timeoutMs),
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode ?? 0 }));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end(opts.body);
  });
}

/**
 * Resolve once, vet, and POST to the vetted address. With `allowPrivate`
 * (development only) the address is not vetted.
 */
export async function postToPublicEndpoint(
  url: URL,
  opts: {
    headers: Record<string, string>;
    body: string;
    timeoutMs: number;
    allowPrivate?: boolean;
    resolver?: Resolver;
  },
): Promise<PostResult> {
  let target: ResolvedEndpoint;
  if (opts.allowPrivate) {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const literal = isIP(host);
    const [first] = literal
      ? [{ address: host, family: literal }]
      : await (opts.resolver ?? systemResolver)(host);
    if (!first) throw new UnsafeEndpointError(`${host} does not resolve.`);
    target = {
      address: first.address,
      family: first.family === 6 ? 6 : 4,
      allowPrivate: true,
    };
  } else {
    target = await resolvePublicEndpoint(url, opts.resolver);
  }
  return postToPinned(url, target, opts);
}
