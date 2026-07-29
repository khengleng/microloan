import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PlatformQrService } from './platform-qr.service';
import { PlatformGuard } from '../auth/platform.guard';
import { Roles } from '../auth/roles.decorator';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permission.enum';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';

export class UploadPlatformQrDto {
  /**
   * Base64 PNG/JPEG, with or without a `data:` prefix. Capped well under the
   * 5 MB global body limit; a phone screenshot is ~200 KB.
   */
  @IsOptional()
  @IsString()
  @MaxLength(8_000_000)
  image?: string;

  /** Raw EMVCo payload, for operators who already have the text. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  payload?: string;
}

/**
 * Platform payment-QR configuration.
 *
 * SUPERADMIN-only through the same three controls as the tenants surface:
 * PlatformGuard (role + tenantId === null), a TENANT_* permission no other
 * role holds, and the global guard chain. The underlying model is in the
 * Prisma guard's PLATFORM_ONLY set, so even a bug here cannot expose it to a
 * tenant principal.
 */
@UseGuards(PlatformGuard)
@Controller('platform/payment-qr')
export class PlatformQrController {
  constructor(private readonly service: PlatformQrService) {}

  @Roles('SUPERADMIN')
  @RequirePermissions(Permission.TENANT_VIEW)
  @Get()
  status() {
    return this.service.status();
  }

  /**
   * Digest an upload and show what was read WITHOUT saving it, so the operator
   * can confirm the merchant details before committing.
   */
  @Roles('SUPERADMIN')
  @RequirePermissions(Permission.TENANT_UPDATE)
  @Post('preview')
  preview(@Body() dto: UploadPlatformQrDto) {
    const { merchant, sourceType } = this.service.digest(dto);
    return { merchant, sourceType };
  }

  @Roles('SUPERADMIN')
  @RequirePermissions(Permission.TENANT_UPDATE)
  @Post()
  upload(@CurrentUser() user: JwtPayload, @Body() dto: UploadPlatformQrDto) {
    return this.service.upload(dto, user.sub);
  }

  /** Render the exact code a payer would scan for one plan. */
  @Roles('SUPERADMIN')
  @RequirePermissions(Permission.TENANT_VIEW)
  @Get('plan-preview')
  planPreview(@Query('plan') plan: string) {
    // Validated against the tier table by the service, which 400s on an
    // unknown name rather than silently previewing some other plan's price.
    return this.service.previewForPlan(plan);
  }

  @Roles('SUPERADMIN')
  @RequirePermissions(Permission.TENANT_UPDATE)
  @Delete()
  deactivate() {
    return this.service.deactivate();
  }
}
