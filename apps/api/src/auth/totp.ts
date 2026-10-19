import { verify } from 'otplib';
import { decryptField } from '../common/field-crypto';

/**
 * The TOTP time step a code belongs to, or null when the code does not match
 * the user's stored (encrypted) secret.
 *
 * otplib's verify() is async and resolves to `{ valid, timeStep }`. A bare
 * Promise is always truthy, so it must be awaited and `.valid` read —
 * otherwise every code passes.
 *
 * `afterTimeStep` is the last step already accepted for this person: a code
 * from that step or an earlier one is refused, so a code seen over a
 * shoulder or in a proxy log cannot be used a second time (D-129). The
 * caller still records the new step atomically (AuthService.acceptTotp), so
 * two requests racing with the same code cannot both pass.
 */
export async function totpTimeStepFor(
  code: unknown,
  encryptedSecret: string,
  afterTimeStep?: number | null,
): Promise<number | null> {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) return null;
  const secret = decryptField(encryptedSecret);
  if (!secret) return null;
  try {
    const result = await verify({
      token: code.trim(),
      secret,
      ...(typeof afterTimeStep === 'number' ? { afterTimeStep } : {}),
    });
    if (result?.valid !== true) return null;
    const step = (result as { timeStep?: unknown }).timeStep;
    if (typeof step !== 'number' || !Number.isInteger(step)) return null;
    if (typeof afterTimeStep === 'number' && step <= afterTimeStep) return null;
    return step;
  } catch {
    return null;
  }
}

/** Whether a code matches at all (no replay bookkeeping). */
export async function totpCodeMatches(
  code: unknown,
  encryptedSecret: string,
): Promise<boolean> {
  return (await totpTimeStepFor(code, encryptedSecret)) !== null;
}
