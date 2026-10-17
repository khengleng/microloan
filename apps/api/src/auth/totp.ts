import { verify } from 'otplib';
import { decryptField } from '../common/field-crypto';

/**
 * Check a TOTP code against a user's stored (encrypted) secret.
 *
 * otplib's verify() is async and resolves to `{ valid }`. A bare Promise is
 * always truthy, so it must be awaited and `.valid` read — otherwise every
 * code passes.
 */
export async function totpCodeMatches(
  code: unknown,
  encryptedSecret: string,
): Promise<boolean> {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) return false;
  const secret = decryptField(encryptedSecret);
  if (!secret) return false;
  try {
    const result = await verify({ token: code.trim(), secret });
    return result?.valid === true;
  } catch {
    return false;
  }
}
