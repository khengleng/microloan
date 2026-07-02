import { Equals, IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class SignAgreementDto {
  // The borrower/signer must explicitly accept the disclosed Key Facts.
  @IsBoolean()
  @Equals(true, { message: 'You must accept the Key Facts to sign.' })
  acceptTerms!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  signatureName?: string;

  // Drawn signature as a base64 data URI (optional). Capped ~700KB.
  @IsOptional()
  @IsString()
  @MaxLength(700_000)
  signatureImage?: string;
}
