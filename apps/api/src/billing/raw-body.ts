import type { IncomingMessage } from 'node:http';

/**
 * Routes whose handler needs the exact bytes the sender signed. Stripe signs
 * the raw request body; the JSON parser's object, re-serialised, is not the
 * same bytes, so verification of `req.body` always failed (DECISIONS D-166).
 */
export const RAW_BODY_ROUTES = ['/v1/billing/webhook'];

export type RawBodyRequest = IncomingMessage & {
  rawBody?: Buffer;
  originalUrl?: string;
};

function pathOf(req: RawBodyRequest): string {
  const url = req.originalUrl ?? req.url ?? '';
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

/**
 * Options for the JSON body parser: the usual size limit, and the raw bytes
 * kept on `req.rawBody` for the signed routes only. Nest's global
 * `rawBody: true` would keep a second copy of every request body (up to the
 * body limit) for the life of every request; this keeps it where it is used.
 */
export function jsonBodyParserOptions(limit: string, routes = RAW_BODY_ROUTES) {
  return {
    limit,
    verify: (req: RawBodyRequest, _res: unknown, buf: Buffer) => {
      if (Buffer.isBuffer(buf) && routes.includes(pathOf(req)))
        req.rawBody = buf;
    },
  };
}
