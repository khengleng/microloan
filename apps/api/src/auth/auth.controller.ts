import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Get,
  UseGuards,
  UnauthorizedException,
  Req,
} from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto, RefreshDto } from './dto/login.dto';
import { RegisterTenantDto } from './dto/register-tenant.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { Roles } from './roles.decorator';
import { CurrentUser } from './current-user.decorator';
import type { JwtPayload } from './jwt.strategy';

/** Extract real client IP — works with Railway proxy (app.set('trust proxy', 1) in main.ts) */
function getIp(req: any): string {
  return req.ip || 'unknown';
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  /** 5 registrations / IP / hr */
  @Throttle({ register: {} })
  @Post('register-tenant')
  register(@Body() registerDto: RegisterTenantDto, @Req() req: any) {
    return this.authService.registerTenant(registerDto, getIp(req));
  }

  /** 10 login attempts / IP / 15 min */
  @Throttle({ login: {} })
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() loginDto: LoginDto, @Req() req: any) {
    return this.authService.login(loginDto, getIp(req));
  }

  /** Refresh tokens — same login limit */
  @Throttle({ login: {} })
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  refresh(@Body() refreshDto: RefreshDto) {
    return this.authService.refreshToken(refreshDto.refreshToken);
  }

  @SkipThrottle()
  @UseGuards(JwtAuthGuard)
  @Get('me')
  getProfile(@CurrentUser() user: JwtPayload) {
    return user;
  }

  /**
   * Step 2 of the MFA login flow.
   * Accepts the short-lived mfaToken issued by POST /auth/login (not a raw userId),
   * so attackers cannot brute-force TOTP codes for arbitrary user IDs.
   */
  @Throttle({ mfa: {} })
  @Post('mfa/authenticate')
  @HttpCode(HttpStatus.OK)
  verifyMfa(@Body() dto: { mfaToken: string; code: string }, @Req() req: any) {
    return this.authService.verifyMfa(dto.mfaToken, dto.code, getIp(req));
  }

  @SkipThrottle()
  @UseGuards(JwtAuthGuard)
  @Post('mfa/generate')
  generateMfaSecret(@CurrentUser() user: JwtPayload) {
    return this.authService.generateMfaSecret(user.sub);
  }

  @SkipThrottle()
  @UseGuards(JwtAuthGuard)
  @Post('mfa/enable')
  enableMfa(@CurrentUser() user: JwtPayload, @Body() dto: { code: string }) {
    return this.authService.enableMfa(user.sub, dto.code);
  }

  /**
   * Promote a user to SUPERADMIN — requires an existing SUPERADMIN JWT.
   * Replaces the previous shared-secret body pattern.
   */
  @SkipThrottle()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  @HttpCode(HttpStatus.OK)
  @Post('promote-superadmin')
  async promoteSuperadmin(@Body() body: { email: string }) {
    return this.authService.promoteSuperadmin(body.email);
  }

  /**
   * List all superadmins — SUPERADMIN-only, authenticated endpoint.
   */
  @SkipThrottle()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  @HttpCode(HttpStatus.OK)
  @Post('list-superadmins')
  async listSuperadmins() {
    return this.authService.listSuperadmins();
  }
}
