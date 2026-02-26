import { AuthService } from './auth.service';
import { LoginDto, RefreshDto } from './dto/login.dto';
import type { JwtPayload } from './jwt.strategy';
export declare class AuthController {
    private readonly authService;
    constructor(authService: AuthService);
    login(loginDto: LoginDto): Promise<{
        access_token: string;
        refresh_token: string;
    }>;
    refresh(refreshDto: RefreshDto): Promise<{
        access_token: string;
        refresh_token: string;
    }>;
    getProfile(user: JwtPayload): JwtPayload;
}
