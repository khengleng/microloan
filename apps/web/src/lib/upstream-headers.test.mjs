// Run with: pnpm --filter web test   (node:test; Node strips the TS types)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientIpFrom, upstreamIdentity, apiJsonHeaders, INTERNAL_HEADERS } from './upstream-headers.ts';

const headers = (h) => new Headers(h);

test('takes the rightmost X-Forwarded-For hop, not the client-supplied left one', () => {
    assert.equal(clientIpFrom(headers({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' })), '203.0.113.9');
    assert.equal(clientIpFrom(headers({ 'x-forwarded-for': ' 203.0.113.9 ' })), '203.0.113.9');
});

test('falls back to X-Real-IP, then loopback', () => {
    assert.equal(clientIpFrom(headers({ 'x-real-ip': '198.51.100.4' })), '198.51.100.4');
    assert.equal(clientIpFrom(headers({})), '127.0.0.1');
});

test('states the client IP and proves it with the shared secret', () => {
    const out = upstreamIdentity(headers({ 'x-forwarded-for': '1.1.1.1, 203.0.113.9' }), 's'.repeat(40));
    assert.equal(out['X-Client-IP'], '203.0.113.9');
    assert.equal(out['X-Forwarded-For'], '203.0.113.9');
    assert.equal(out['X-Web-Proxy-Secret'], 's'.repeat(40));
});

test('sends no proof when WEB_PROXY_SECRET is unset', () => {
    const out = upstreamIdentity(headers({ 'x-forwarded-for': '203.0.113.9' }), undefined);
    assert.equal(out['X-Client-IP'], '203.0.113.9');
    assert.equal('X-Web-Proxy-Secret' in out, false);
});

test('a browser-sent X-Client-IP never becomes the stated address', () => {
    const out = upstreamIdentity(
        headers({ 'x-client-ip': '6.6.6.6', 'x-forwarded-for': '203.0.113.9' }),
        's'.repeat(40),
    );
    assert.equal(out['X-Client-IP'], '203.0.113.9');
    assert.ok(INTERNAL_HEADERS.includes('x-client-ip'));
    assert.ok(INTERNAL_HEADERS.includes('x-web-proxy-secret'));
});

test('JSON headers carry the content type and the identity', () => {
    const out = apiJsonHeaders(headers({ 'x-forwarded-for': '203.0.113.9' }));
    assert.equal(out['Content-Type'], 'application/json');
    assert.equal(out['X-Client-IP'], '203.0.113.9');
});
