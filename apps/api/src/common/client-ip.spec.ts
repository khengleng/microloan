import { clientIp, isTrustedWebProxy } from './client-ip';

const SECRET = 'a'.repeat(40);

function req(headers: Record<string, string> = {}, ip = '10.0.0.5') {
  return { ip, headers, socket: { remoteAddress: '10.9.9.9' } };
}

describe('clientIp — the browser address behind the web server', () => {
  it('believes X-Client-IP when the web proxy secret matches', () => {
    const r = req({ 'x-web-proxy-secret': SECRET, 'x-client-ip': '203.0.113.7' });
    expect(isTrustedWebProxy(r, SECRET)).toBe(true);
    expect(clientIp(r, SECRET)).toBe('203.0.113.7');
  });

  it('accepts an IPv6 client address', () => {
    const r = req({ 'x-web-proxy-secret': SECRET, 'x-client-ip': '2001:db8::1' });
    expect(clientIp(r, SECRET)).toBe('2001:db8::1');
  });

  it('ignores X-Client-IP with a wrong secret', () => {
    const r = req({ 'x-web-proxy-secret': 'b'.repeat(40), 'x-client-ip': '203.0.113.7' });
    expect(isTrustedWebProxy(r, SECRET)).toBe(false);
    expect(clientIp(r, SECRET)).toBe('10.0.0.5');
  });

  it('ignores X-Client-IP with a secret of a different length', () => {
    const r = req({ 'x-web-proxy-secret': 'short', 'x-client-ip': '203.0.113.7' });
    expect(clientIp(r, SECRET)).toBe('10.0.0.5');
  });

  it('ignores X-Client-IP when no secret is presented', () => {
    const r = req({ 'x-client-ip': '203.0.113.7' });
    expect(clientIp(r, SECRET)).toBe('10.0.0.5');
  });

  it('ignores X-Client-IP when the API has no secret configured', () => {
    const r = req({ 'x-web-proxy-secret': SECRET, 'x-client-ip': '203.0.113.7' });
    expect(isTrustedWebProxy(r, '')).toBe(false);
    expect(clientIp(r, undefined)).toBe('10.0.0.5');
  });

  it('falls back to req.ip when the stated address is not an IP', () => {
    const r = req({ 'x-web-proxy-secret': SECRET, 'x-client-ip': '1.2.3.4, 5.6.7.8' });
    expect(clientIp(r, SECRET)).toBe('10.0.0.5');
  });

  it('falls back to the socket address when Express has no req.ip', () => {
    const r = { headers: {}, socket: { remoteAddress: '10.9.9.9' } };
    expect(clientIp(r, SECRET)).toBe('10.9.9.9');
  });
});
