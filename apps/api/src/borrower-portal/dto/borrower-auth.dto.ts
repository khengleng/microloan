import { IsIn, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

export class RequestOtpDto {
  @IsString()
  @MinLength(6)
  @MaxLength(20)
  phone!: string;
}

export class VerifyOtpDto {
  @IsString()
  @MinLength(6)
  @MaxLength(20)
  phone!: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^[0-9]{6}$/, { message: 'Code must be 6 digits' })
  code!: string;
}

export class UploadKycDto {
  @IsString()
  @IsIn(['NATIONAL_ID_FRONT', 'NATIONAL_ID_BACK', 'PASSPORT', 'SELFIE', 'PROOF_OF_ADDRESS', 'OTHER'])
  type!: string;

  // base64 data URI or URL (mirrors Document.content). Capped ~2.7MB base64.
  @IsString()
  @MaxLength(2_800_000)
  content!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  mimeType?: string;
}
