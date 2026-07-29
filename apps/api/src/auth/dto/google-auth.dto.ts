import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class GoogleLoginDto {
  /** The ID token returned by Google Identity Services on the client. */
  @IsNotEmpty()
  @IsString()
  idToken: string;
}

export class GoogleRegisterTenantDto {
  @IsNotEmpty()
  @IsString()
  idToken: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(120)
  organizationName: string;

  /**
   * Tier name. Checked against the live `PlanTier` catalogue by
   * `AuthService.resolveSignupTier` rather than by `@IsIn` here — the operator
   * edits tiers at runtime, so a compile-time list would reject a plan the
   * signup page is currently offering. That check refuses unknown and retired
   * names outright; it never falls through to a free tier, which would skip the
   * payment gate.
   */
  @IsNotEmpty()
  @IsString()
  @MaxLength(32)
  plan: string;
}

export class SignupPaymentLookupDto {
  @IsOptional()
  @IsString()
  reference?: string;
}
