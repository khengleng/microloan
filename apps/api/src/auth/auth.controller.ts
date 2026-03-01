import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Get,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto, RefreshDto } from './dto/login.dto';
import { RegisterTenantDto } from './dto/register-tenant.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import type { JwtPayload } from './jwt.strategy';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  @Post('register-tenant')
  register(@Body() registerDto: RegisterTenantDto) {
    return this.authService.registerTenant(registerDto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
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
  verifyMfa(@Body() dto: { userId: string; code: string }) {
    return this.authService.verifyMfa(dto.userId, dto.code);
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
   * One-time admin setup endpoints — protected by SETUP_SECRET env variable.
   * Use these to promote an existing account to SUPERADMIN or to see who is SUPERADMIN.
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
