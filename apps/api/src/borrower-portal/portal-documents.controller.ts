import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { BorrowerRoute } from '../auth/auth-scope.decorator';
import { BorrowerJwtGuard } from './borrower-jwt.guard';
import {
  LendingAction,
  lendingActorOf,
} from '../lending/policy/lending-action.guard';
import { ZodPipe } from '../lending/common/zod.pipe';
import { CustomerDocumentsService } from '../lending/documents/customer-documents.service';
import {
  fileSchema,
  sendFile,
} from '../lending/documents/documents.controller';

const ID = new ParseUUIDPipe();
const actor = (req: Request) => lendingActorOf(req as never);

/**
 * Borrower portal: "documents requested from you" and the customer's own
 * documents (DOC-10). The borrower acts only on their own requests and
 * documents; the tenant and borrower come from the verified portal session.
 */
@BorrowerRoute()
@UseGuards(BorrowerJwtGuard)
@Controller('borrower')
export class PortalDocumentsController {
  constructor(private readonly docs: CustomerDocumentsService) {}

  @LendingAction('document.read_own')
  @Get('document-requests')
  requests(@Req() req: Request) {
    return this.docs.ownRequests(actor(req));
  }

  @LendingAction('document.upload_own')
  @Post('document-requests/:requestId/upload')
  upload(
    @Req() req: Request,
    @Param('requestId', ID) requestId: string,
    @Body(new ZodPipe(fileSchema)) body: z.infer<typeof fileSchema>,
  ) {
    return this.docs.uploadAgainstRequest(actor(req), requestId, body);
  }

  @LendingAction('document.read_own')
  @Get('my-documents')
  documents(@Req() req: Request) {
    return this.docs.ownDocuments(actor(req));
  }

  @LendingAction('document.read_own')
  @Get('my-documents/:documentId/download')
  async download(
    @Req() req: Request,
    @Param('documentId', ID) documentId: string,
    @Res() res: Response,
  ) {
    sendFile(res, await this.docs.downloadOwn(actor(req), documentId));
  }
}
