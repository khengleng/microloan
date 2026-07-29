import { IsEmail, IsNotEmpty, MinLength, IsString, MaxLength, IsOptional } from 'class-validator';

export class RegisterTenantDto {
    @IsNotEmpty()
    @IsString()
    organizationName: string;

    @IsEmail()
    adminEmail: string;

    @IsNotEmpty()
    @MinLength(12, { message: 'Password must be at least 12 characters.' })
    adminPassword: string;

    /**
     * Requested plan, by tier name. Optional — an omitted plan means the
     * platform's free tier. Any priced tier puts the new workspace behind the
     * KHQR payment gate.
     *
     * Not validated with `@IsIn` any more: the valid set is rows in `PlanTier`,
     * which the operator edits at runtime, so a compile-time list would go
     * stale the first time they add a tier. `AuthService.resolveSignupTier`
     * checks it against the live catalogue and 400s on an unknown or retired
     * name.
     */
    @IsOptional()
    @IsString()
    @MaxLength(32)
    plan?: string;
}
