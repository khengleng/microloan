import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { LoansService } from './loans.service';
import { CreateLoanDto, ChangeLoanStatusDto } from './dto/create-loan.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';

@UseGuards(JwtAuthGuard)
@Controller('loans')
export class LoansController {
  constructor(private readonly loansService: LoansService) { }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateLoanDto) {
    return this.loansService.create(user.tenantId, user.sub, dto);
  }

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.loansService.findAll(user.tenantId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.loansService.findOne(user.tenantId, id);
  }

  @Put(':id/status')
  changeStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ChangeLoanStatusDto,
  ) {
    return this.loansService.changeStatus(user.tenantId, user.sub, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.loansService.remove(user.tenantId, user.sub, id);
  }

  @Post(':id/documents')
  addDocument(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: { name: string; content: string; type: string },
  ) {
    return this.loansService.addDocument(user.tenantId, user.sub, id, dto);
  }

  @Delete(':id/documents/:documentId')
  removeDocument(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
  ) {
    return this.loansService.removeDocument(user.tenantId, user.sub, id, documentId);
  }
}
