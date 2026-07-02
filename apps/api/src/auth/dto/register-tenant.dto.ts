import { IsEmail, IsNotEmpty, MinLength, IsString } from 'class-validator';

export class RegisterTenantDto {
    @IsNotEmpty()
    @IsString()
    organizationName: string;

    @IsEmail()
    adminEmail: string;

    @IsNotEmpty()
    @MinLength(12, { message: 'Password must be at least 12 characters.' })
    adminPassword: string;
}
