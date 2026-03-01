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
import { AuthService } from './auth.service';
import { LoginDto, RefreshDto } from './dto/login.dto';
import { RegisterTenantDto } from './dto/register-tenant.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import type { JwtPayload } from './jwt.strategy';

/** Extract real IP — works behind Railway / proxy forwarding */
function getIp(req: any): string {
  const forwarded = req.headers?.['x-forwarded-for'];
  if (forwarded) {
    return (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(',')[0].trim();
  }
  return req.socket?.remoteAddress || req.ip || 'unknown';
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  @Post('register-tenant')
  register(@Body() registerDto: RegisterTenantDto, @Req() req: any) {
    return this.authService.registerTenant(registerDto, getIp(req));
  }

  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() loginDto: LoginDto, @Req() req: any) {
    return this.authService.login(loginDto, getIp(req));
  }

  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  refresh(@Body() refreshDto: RefreshDto) {
    return this.authService.refreshToken(refreshDto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getProfile(@CurrentUser() user: JwtPayload) {
    return user;
  }

  @Post('mfa/authenticate')
  @HttpCode(HttpStatus.OK)
  verifyMfa(@Body() dto: { userId: string; code: string }, @Req() req: any) {
    return this.authService.verifyMfa(dto.userId, dto.code, getIp(req));
  }

  @UseGuards(JwtAuthGuard)
  @Post('mfa/generate')
  generateMfaSecret(@CurrentUser() user: JwtPayload) {
    return this.authService.generateMfaSecret(user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post('mfa/enable')
  enableMfa(@CurrentUser() user: JwtPayload, @Body() dto: { code: string }) {
    return this.authService.enableMfa(user.sub, dto.code);
  }

  /**
   * Secured by SETUP_SECRET env variable — one-time admin setup only.
   */
  @HttpCode(HttpStatus.OK)
  @Post('promote-superadmin')
  async promoteSuperadmin(@Body() body: { email: string; secret: string }) {
    const setupSecret = process.env.SETUP_SECRET;
    if (!setupSecret || body.secret !== setupSecret) {
      throw new UnauthorizedException('Invalid setup secret');
    }
    return this.authService.promoteSuperadmin(body.email);
  }

  @HttpCode(HttpStatus.OK)
  @Post('list-superadmins')
  async listSuperadmins(@Body() body: { secret: string }) {
    const setupSecret = process.env.SETUP_SECRET;
    if (!setupSecret || body.secret !== setupSecret) {
      throw new UnauthorizedException('Invalid setup secret');
    }
    return this.authService.listSuperadmins();
  }
}
