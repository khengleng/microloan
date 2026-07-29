import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export type PlanCurrency = 'USD' | 'KHR';

/**
 * A quota field. `null` is a legitimate value meaning unlimited, so validation
 * is skipped for null but still applied to any number that is supplied —
 * `@IsOptional()` alone would also wave through a negative ceiling.
 */
const IsQuota = () => (target: object, key: string) => {
  ValidateIf((o: Record<string, unknown>) => o[key] !== null)(target, key);
  IsOptional()(target, key);
  IsInt()(target, key);
  Min(1, { message: `${key} must be at least 1, or null for unlimited.` })(
    target,
    key,
  );
};

export class CreatePlanTierDto {
  /**
   * Stable key, stored on every organization on this tier. Normalised to
   * uppercase and immutable afterwards — see `PlanTierService.update`.
   */
  @IsString()
  @MinLength(2)
  @MaxLength(32)
  name: string;

  /** Customer-visible label. Editable at any time. */
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  displayName: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  /** Monthly price. 0 means the tier activates without the payment gate. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount: number;

  @IsIn(['USD', 'KHR'])
  currency: PlanCurrency;

  @IsQuota() maxUsers?: number | null;
  @IsQuota() maxBorrowers?: number | null;
  @IsQuota() maxLoanProducts?: number | null;
  @IsQuota() maxLoans?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Everything except `name`, which cannot change once organizations hold it. */
export class UpdatePlanTierDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsIn(['USD', 'KHR'])
  currency?: PlanCurrency;

  @IsQuota() maxUsers?: number | null;
  @IsQuota() maxBorrowers?: number | null;
  @IsQuota() maxLoanProducts?: number | null;
  @IsQuota() maxLoans?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ReorderPlanTiersDto {
  /** Tier ids in the order they should appear on the signup page. */
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  ids: string[];
}
