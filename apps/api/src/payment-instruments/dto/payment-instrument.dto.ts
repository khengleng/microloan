import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

// A static QR is display-only. Either `qrPayload` (KHQR/EMVCo string we render)
// or `qrImage` (uploaded image data URI / URL) should be provided — enforced in
// the service so we can return a friendly message.
export class CreatePaymentInstrumentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  label!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  bankName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  accountName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  accountNumber?: string;

  // KHQR / EMVCo static payload. Capped to a sane size; a QR payload is short.
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  qrPayload?: string;

  // Fallback uploaded image (base64 data URI or URL). Capped ~1.3MB base64.
  @IsOptional()
  @IsString()
  @MaxLength(1_400_000)
  qrImage?: string;

  @IsOptional()
  @IsIn(['USD', 'KHR'])
  currency?: 'USD' | 'KHR';

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdatePaymentInstrumentDto extends CreatePaymentInstrumentDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  declare label: string;
}
