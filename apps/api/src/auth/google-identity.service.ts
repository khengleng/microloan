import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';

export type GoogleProfile = {
  /** Google's stable subject id. This, not the email, is the account key. */
  subject: string;
  email: string;
  name?: string;
  picture?: string;
  /** Workspace domain, when the account belongs to one. */
  hostedDomain?: string;
};

/**
 * Verifies Google ID tokens.
 *
 * Config-gated in the same way as CBC and Stripe: with no GOOGLE_CLIENT_ID the
 * whole feature reports itself unavailable rather than half-working.
 */
@Injectable()
export class GoogleIdentityService {
  private readonly logger = new Logger(GoogleIdentityService.name);
  private client?: OAuth2Client;

  static readonly PROVIDER = 'GOOGLE';

  get clientId(): string | undefined {
    return process.env.GOOGLE_CLIENT_ID?.trim() || undefined;
  }

  isConfigured(): boolean {
    return Boolean(this.clientId);
  }

  /**
   * Workspace domains allowed to sign in, as a comma-separated env value.
   * Empty means any Google account is acceptable.
   */
  private allowedDomains(): string[] {
    return (process.env.GOOGLE_ALLOWED_DOMAINS || '')
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
  }

  async verify(idToken: string): Promise<GoogleProfile> {
    const clientId = this.clientId;
    if (!clientId) {
      throw new ServiceUnavailableException(
        'Google sign-in is not configured for this platform.',
      );
    }
    if (!idToken || typeof idToken !== 'string') {
      throw new UnauthorizedException('Missing Google credential.');
    }

    this.client ??= new OAuth2Client(clientId);

    let payload;
    try {
      // verifyIdToken checks the signature against Google's rotating JWKS and
      // validates `aud`, `iss` and `exp`. Passing `audience` is what binds the
      // token to this application — without it, a token minted for any other
      // Google client would verify.
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: clientId,
      });
      payload = ticket.getPayload();
    } catch (err) {
      this.logger.warn(
        `Google ID token rejected: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new UnauthorizedException('Google sign-in failed.');
    }

    if (!payload?.sub || !payload.email) {
      throw new UnauthorizedException('Google sign-in failed.');
    }

    // Non-negotiable: an unverified email must never be used to find or link a
    // local account, or anyone able to set an arbitrary Google profile email
    // could take over the matching staff account.
    if (!payload.email_verified) {
      throw new UnauthorizedException(
        'Your Google account email is not verified. Verify it with Google and try again.',
      );
    }

    const allowed = this.allowedDomains();
    if (allowed.length > 0) {
      const domain = (
        payload.hd ||
        payload.email.split('@')[1] ||
        ''
      ).toLowerCase();
      if (!allowed.includes(domain)) {
        throw new UnauthorizedException(
          'This Google account domain is not permitted on this platform.',
        );
      }
    }

    return {
      subject: payload.sub,
      email: payload.email.toLowerCase(),
      name: payload.name,
      picture: payload.picture,
      hostedDomain: payload.hd,
    };
  }
}
