import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
    @IsString()
    @IsNotEmpty()
    @MinLength(12, { message: 'Password must be at least 12 characters.' })
    password: string;
}
