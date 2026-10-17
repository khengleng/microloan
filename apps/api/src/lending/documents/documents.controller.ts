import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { Public } from '../../auth/auth-scope.decorator';
import { LendingAction, lendingActorOf } from '../policy/lending-action.guard';
import { ZodPipe } from '../common/zod.pipe';
import { CustomerDocumentsService } from './customer-documents.service';
import { GeneratedDocumentsService } from './generated-documents.service';
import { DOCUMENT_CATEGORIES } from './document-rules';

const ID = new ParseUUIDPipe();
const actor = (req: Request) => lendingActorOf(req as never);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dates are YYYY-MM-DD');
const typeCode = z.string().regex(/^[A-Z0-9_]{2,40}$/);
const category = z.enum(DOCUMENT_CATEGORIES);

export const fileSchema = z
  .object({
    fileName: z.string().min(1).max(200),
    mimeType: z.string().max(100),
    contentBase64: z.string().min(1).max(5_000_000),
  })
  .strict();

const uploadSchema = fileSchema
  .extend({
    category,
    typeCode,
    title: z.string().max(160).optional(),
    applicationId: z.string().uuid().optional(),
    loanAccountId: z.string().uuid().optional(),
    collateralId: z.string().uuid().optional(),
    issuedOn: date.optional(),
    expiresOn: date.optional(),
    note: z.string().max(500).optional(),
  })
  .strict();

const replaceSchema = fileSchema
  .extend({
    note: z.string().max(500).optional(),
    issuedOn: date.optional(),
    expiresOn: date.optional(),
  })
  .strict();

const reviewSchema = z
  .object({
    decision: z.enum(['ACCEPT', 'REJECT']),
    reason: z.string().max(500).optional(),
  })
  .strict();

const holdSchema = z
  .object({ hold: z.boolean(), reason: z.string().min(3).max(500) })
  .strict();

const deleteSchema = z.object({ reason: z.string().min(3).max(500) }).strict();

const expirySchema = z
  .object({
    issuedOn: date.nullable().optional(),
    expiresOn: date.nullable().optional(),
  })
  .strict();

const requestSchema = z
  .object({
    category,
    typeCode,
    label: z.string().min(2).max(120),
    message: z.string().max(1000).optional(),
    applicationId: z.string().uuid().optional(),
    loanAccountId: z.string().uuid().optional(),
    dueOn: date.optional(),
  })
  .strict();

const retentionSchema = z
  .object({
    rules: z
      .array(
        z
          .object({
            scope: z.enum(['CATEGORY', 'TYPE']),
            code: typeCode,
            retentionYears: z.number().int().min(1).max(100).nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();

const linkSchema = z
  .object({ version: z.number().int().min(1).optional() })
  .strict();

const quoteLetterSchema = z.object({ asOf: date.optional() }).strict();

/**
 * Customer document library (DOC-1..9), staff side. Every route names its
 * lending action; the service decides on the specific customer (tenant,
 * branch scope, maker-checker) inside its transaction.
 */
@Controller('lending')
export class LendingDocumentsController {
  constructor(
    private readonly docs: CustomerDocumentsService,
    private readonly generated: GeneratedDocumentsService,
  ) {}

  @LendingAction('document.read')
  @Get('customers/:borrowerId/documents')
  library(
    @Req() req: Request,
    @Param('borrowerId', ID) borrowerId: string,
    @Query('includeDeleted') includeDeleted?: string,
  ) {
    return this.docs.library(actor(req), borrowerId, {
      includeDeleted: includeDeleted === 'true',
    });
  }

  @LendingAction('document.upload')
  @Post('customers/:borrowerId/documents')
  upload(
    @Req() req: Request,
    @Param('borrowerId', ID) borrowerId: string,
    @Body(new ZodPipe(uploadSchema)) body: z.infer<typeof uploadSchema>,
  ) {
    return this.docs.upload(actor(req), borrowerId, body);
  }

  @LendingAction('document.read')
  @Get('customers/:borrowerId/document-checklist')
  customerChecklist(
    @Req() req: Request,
    @Param('borrowerId', ID) borrowerId: string,
  ) {
    return this.docs.checklistForCustomer(actor(req), borrowerId);
  }

  @LendingAction('document.upload')
  @Post('customers/:borrowerId/document-requests')
  request(
    @Req() req: Request,
    @Param('borrowerId', ID) borrowerId: string,
    @Body(new ZodPipe(requestSchema)) body: z.infer<typeof requestSchema>,
  ) {
    return this.docs.createRequest(actor(req), borrowerId, body);
  }

  @LendingAction('document.upload')
  @Post('document-requests/:requestId/cancel')
  cancelRequest(
    @Req() req: Request,
    @Param('requestId', ID) requestId: string,
  ) {
    return this.docs.cancelRequest(actor(req), requestId);
  }

  @LendingAction('document.read')
  @Get('applications/:id/document-checklist')
  applicationChecklist(@Req() req: Request, @Param('id', ID) id: string) {
    return this.docs.checklistForApplication(actor(req), id);
  }

  @LendingAction('document.review')
  @Get('document-review-queue')
  queue(@Req() req: Request) {
    return this.docs.reviewQueue(actor(req));
  }

  @LendingAction('document.read')
  @Get('document-expiries')
  expiries(@Req() req: Request, @Query('withinDays') withinDays?: string) {
    const n = Number(withinDays ?? 60);
    return this.docs.expiries(actor(req), Number.isInteger(n) ? n : 60);
  }

  @LendingAction('document.expiry.run')
  @Post('document-expiries/run')
  runExpiry(@Req() req: Request) {
    return this.docs.runExpiryNow(actor(req));
  }

  @LendingAction('document.retention.manage')
  @Get('document-retention')
  retention(@Req() req: Request) {
    return this.docs.retentionRules(actor(req));
  }

  @LendingAction('document.retention.manage')
  @Put('document-retention')
  setRetention(
    @Req() req: Request,
    @Body(new ZodPipe(retentionSchema)) body: z.infer<typeof retentionSchema>,
  ) {
    return this.docs.setRetentionRules(actor(req), body);
  }

  @LendingAction('document.retention.manage')
  @Post('document-library/link-legacy')
  linkLegacy(@Req() req: Request) {
    return this.docs.linkAllLegacy(actor(req));
  }

  @LendingAction('document.read')
  @Get('documents/:documentId')
  get(@Req() req: Request, @Param('documentId', ID) documentId: string) {
    return this.docs.get(actor(req), documentId);
  }

  @LendingAction('document.upload')
  @Post('documents/:documentId/versions')
  replace(
    @Req() req: Request,
    @Param('documentId', ID) documentId: string,
    @Body(new ZodPipe(replaceSchema)) body: z.infer<typeof replaceSchema>,
  ) {
    return this.docs.replace(actor(req), documentId, body);
  }

  @LendingAction('document.review')
  @Post('documents/:documentId/review')
  review(
    @Req() req: Request,
    @Param('documentId', ID) documentId: string,
    @Body(new ZodPipe(reviewSchema)) body: z.infer<typeof reviewSchema>,
  ) {
    return this.docs.review(actor(req), documentId, body);
  }

  @LendingAction('document.read')
  @Post('documents/:documentId/link')
  link(
    @Req() req: Request,
    @Param('documentId', ID) documentId: string,
    @Body(new ZodPipe(linkSchema)) body: z.infer<typeof linkSchema>,
  ) {
    return this.docs.link(actor(req), documentId, body.version);
  }

  @LendingAction('document.upload')
  @Put('documents/:documentId/expiry')
  setExpiry(
    @Req() req: Request,
    @Param('documentId', ID) documentId: string,
    @Body(new ZodPipe(expirySchema)) body: z.infer<typeof expirySchema>,
  ) {
    return this.docs.setExpiry(actor(req), documentId, body);
  }

  @LendingAction('document.manage')
  @Post('documents/:documentId/legal-hold')
  legalHold(
    @Req() req: Request,
    @Param('documentId', ID) documentId: string,
    @Body(new ZodPipe(holdSchema)) body: z.infer<typeof holdSchema>,
  ) {
    return this.docs.setLegalHold(actor(req), documentId, body);
  }

  @LendingAction('document.manage')
  @Post('documents/:documentId/delete')
  remove(
    @Req() req: Request,
    @Param('documentId', ID) documentId: string,
    @Body(new ZodPipe(deleteSchema)) body: z.infer<typeof deleteSchema>,
  ) {
    return this.docs.delete(actor(req), documentId, body);
  }

  /** DOC-9: issue a settlement quote letter, filed in the customer's library. */
  @LendingAction('loan.read')
  @Post('loans/:id/settlement-quote-letter')
  quoteLetter(
    @Req() req: Request,
    @Param('id', ID) id: string,
    @Body(new ZodPipe(quoteLetterSchema))
    body: z.infer<typeof quoteLetterSchema>,
  ) {
    return this.generated.issueSettlementQuote(actor(req), id, body.asOf);
  }
}

/**
 * Short-lived download links (DOC-8). The signed token is the credential: it
 * names one tenant and one version and expires within minutes. Each fetch is
 * audited.
 */
@Controller('lending/document-links')
export class DocumentLinksController {
  constructor(private readonly docs: CustomerDocumentsService) {}

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get(':token')
  async fetch(@Param('token') token: string, @Res() res: Response) {
    const file = await this.docs.serveLink(token);
    sendFile(res, file);
  }
}

export function sendFile(
  res: Response,
  file: { bytes: Buffer; mimeType: string; fileName: string },
) {
  res.set({
    'Content-Type': file.mimeType,
    'Content-Disposition': `attachment; filename="${file.fileName.replace(/["\r\n]/g, '')}"`,
    'Content-Length': String(file.bytes.length),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
    'Content-Security-Policy':
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  });
  res.send(file.bytes);
}
