// otplib ships ESM-only deps that this project's jest transform cannot load, so
// it is stubbed — with the real library's contract: verify() returns a Promise
// resolving to { valid }. The original bug treated that Promise as the result.
const verify = jest.fn();
jest.mock('otplib', () => ({
  verify: (...args: unknown[]) => verify(...args),
}));

import { encryptField } from '../common/field-crypto';
import { totpCodeMatches } from './totp';

// Field encryption needs a key; CI runs the unit tests without one.
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-secret';

describe('totpCodeMatches', () => {
  const secret = encryptField('JBSWY3DPEHPK3PXP')!;

  beforeEach(() => verify.mockReset());

  it('rejects a wrong code even though verify() returns a (truthy) Promise', async () => {
    verify.mockResolvedValue({ valid: false });
    await expect(totpCodeMatches('123456', secret)).resolves.toBe(false);
  });

  it('accepts a code otplib reports as valid', async () => {
    verify.mockResolvedValue({ valid: true });
    await expect(totpCodeMatches('123456', secret)).resolves.toBe(true);
    expect(verify).toHaveBeenCalledWith({
      token: '123456',
      secret: 'JBSWY3DPEHPK3PXP',
    });
  });

  it.each([undefined, '', '12345', '1234567', 'abcdef', 123456])(
    'rejects malformed code %p without calling otplib',
    async (code) => {
      await expect(totpCodeMatches(code, secret)).resolves.toBe(false);
      expect(verify).not.toHaveBeenCalled();
    },
  );

  it('treats an otplib error as a failed check', async () => {
    verify.mockRejectedValue(new Error('bad secret'));
    await expect(totpCodeMatches('123456', secret)).resolves.toBe(false);
  });
});
