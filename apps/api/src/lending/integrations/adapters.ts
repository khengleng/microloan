import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';

/**
 * Integration adapters for the lending platform.
 *
 * Each external dependency sits behind an interface. Real adapters are used
 * when configured; otherwise a mock is returned that is clearly labelled
 * (`isMock`, names prefixed "MOCK_") and refused outright in production, so a
 * mock can never silently stand in for a payment rail or a bureau.
 */

export interface Adapter {
  readonly name: string;
  readonly isMock: boolean;
}

export interface PaymentAdapter extends Adapter {
  payout(input: {
    tenantId: string;
    reference: string;
    amount: string;
    currency: string;
    beneficiary: string;
  }): Promise<{ externalReference: string; status: 'ACCEPTED' }>;
}
export interface KycAdapter extends Adapter {
  verify(input: {
    tenantId: string;
    borrowerId: string;
  }): Promise<{ status: 'VERIFIED' | 'REFERRED'; reference: string }>;
}
export interface CreditBureauAdapter extends Adapter {
  enquire(input: {
    tenantId: string;
    borrowerId: string;
  }): Promise<{ score: number; reference: string }>;
}
export interface NotificationAdapter extends Adapter {
  send(input: {
    tenantId: string;
    topic: string;
    payload: unknown;
  }): Promise<void>;
}
export interface ExternalAccountingAdapter extends Adapter {
  export(input: { tenantId: string; payload: unknown }): Promise<void>;
}
export interface DocumentStorageAdapter extends Adapter {
  put(input: {
    tenantId: string;
    key: string;
    body: Buffer;
    contentType: string;
  }): Promise<{ provider: string; key: string }>;
  get(key: string): Promise<Buffer>;
}

/** Collects an amount from a borrower's bank account under a direct-debit mandate (UC-16). */
export interface BankDebitAdapter extends Adapter {
  debit(input: {
    tenantId: string;
    mandateReference: string;
    bankCode: string;
    accountNumber: string;
    amount: string;
    currency: string;
    /** Unique per attempt; the bank uses it to refuse a repeat. */
    reference: string;
  }): Promise<
    | { status: 'SUCCEEDED'; bankReference: string }
    | { status: 'FAILED'; failureCode: string; bankReference: string | null }
  >;
}

/** The bank's published exchange rate for a pair on a date (UC-21). */
export interface FxRateAdapter extends Adapter {
  rate(input: {
    tenantId: string;
    from: string;
    to: string;
    /** Latest rate published on or before this date. */
    onOrBefore: string;
  }): Promise<{
    base: string;
    quote: string;
    rate: string;
    rateDate: string;
    source: string;
  } | null>;
}

const logger = new Logger('LendingAdapters');

class MockPayments implements PaymentAdapter {
  readonly name = 'MOCK_PAYMENTS';
  readonly isMock = true;
  async payout(input: { reference: string }) {
    logger.warn(`MOCK payout ${input.reference} — no money moved`);
    return {
      externalReference: `MOCK-${input.reference}`,
      status: 'ACCEPTED' as const,
    };
  }
}
class MockKyc implements KycAdapter {
  readonly name = 'MOCK_KYC';
  readonly isMock = true;
  async verify() {
    return {
      status: 'REFERRED' as const,
      reference: `MOCK-KYC-${randomUUID()}`,
    };
  }
}
class MockBureau implements CreditBureauAdapter {
  readonly name = 'MOCK_CREDIT_BUREAU';
  readonly isMock = true;
  async enquire() {
    return { score: 0, reference: `MOCK-CB-${randomUUID()}` };
  }
}
class MockNotifications implements NotificationAdapter {
  readonly name = 'MOCK_NOTIFICATIONS';
  readonly isMock = true;
  async send(input: { topic: string }) {
    logger.log(`MOCK notification ${input.topic}`);
  }
}
class MockAccountingExport implements ExternalAccountingAdapter {
  readonly name = 'MOCK_EXTERNAL_ACCOUNTING';
  readonly isMock = true;
  async export() {
    logger.log('MOCK external accounting export');
  }
}

/**
 * Deterministic bank for development and tests — no money moves. The outcome
 * depends only on the account number: ending in 000 → INSUFFICIENT_FUNDS,
 * ending in 999 → ACCOUNT_CLOSED, anything else succeeds.
 */
class MockBankDebit implements BankDebitAdapter {
  readonly name = 'MOCK_BANK_DEBIT';
  readonly isMock = true;
  async debit(input: { accountNumber: string; reference: string }) {
    logger.warn(`MOCK auto-debit ${input.reference} — no money moved`);
    const ref = `MOCK-DD-${input.reference}`.slice(0, 120);
    if (input.accountNumber.endsWith('000'))
      return {
        status: 'FAILED' as const,
        failureCode: 'INSUFFICIENT_FUNDS',
        bankReference: ref,
      };
    if (input.accountNumber.endsWith('999'))
      return {
        status: 'FAILED' as const,
        failureCode: 'ACCOUNT_CLOSED',
        bankReference: ref,
      };
    return { status: 'SUCCEEDED' as const, bankReference: ref };
  }
}

/**
 * Fixed rates for development only (1 USD = 4100 KHR, 36 THB, 0.92 EUR),
 * "published" every day. Selected with LENDING_FX_SOURCE=MOCK.
 */
class MockFxFeed implements FxRateAdapter {
  readonly name = 'MOCK_FX_FEED';
  readonly isMock = true;
  private readonly usd: Record<string, string> = {
    KHR: '4100',
    THB: '36',
    EUR: '0.92',
  };
  async rate(input: { from: string; to: string; onOrBefore: string }) {
    const pair = input.from === 'USD' ? input.to : input.from;
    const other = input.from === 'USD' ? input.from : input.to;
    if (other !== 'USD' || !this.usd[pair]) return null;
    return {
      base: 'USD',
      quote: pair,
      rate: this.usd[pair],
      rateDate: input.onOrBefore,
      source: this.name,
    };
  }
}

/** Development-only document storage on the local disk. */
class MockDocuments implements DocumentStorageAdapter {
  readonly name = 'MOCK_LOCAL_DISK';
  readonly isMock = true;
  private dir = join(tmpdir(), 'microloan-mock-documents');
  async put(input: { tenantId: string; key: string; body: Buffer }) {
    await mkdir(join(this.dir, input.tenantId), { recursive: true });
    const key = `${input.tenantId}/${createHash('sha256').update(input.key).digest('hex')}`;
    await writeFile(join(this.dir, key), input.body);
    return { provider: this.name, key };
  }
  async get(key: string) {
    return readFile(join(this.dir, key));
  }
}

class S3Documents implements DocumentStorageAdapter {
  readonly name = 'S3';
  readonly isMock = false;
  private client = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    },
  });
  private bucket = process.env.AWS_S3_BUCKET_NAME || '';
  async put(input: {
    tenantId: string;
    key: string;
    body: Buffer;
    contentType: string;
  }) {
    const key = `lending/${input.tenantId}/${input.key}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: input.body,
        ContentType: input.contentType,
        ServerSideEncryption: 'AES256',
      }),
    );
    return { provider: this.name, key };
  }
  async get(key: string) {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return Buffer.from(await res.Body!.transformToByteArray());
  }
}

@Injectable()
export class AdapterRegistry {
  private readonly production = process.env.NODE_ENV === 'production';
  private readonly s3 = !!(
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    process.env.AWS_S3_BUCKET_NAME
  );

  private guard<T extends Adapter>(adapter: T): T {
    if (adapter.isMock && this.production) {
      throw new ServiceUnavailableException(
        `${adapter.name} is a mock adapter and is blocked in production. Configure a real integration.`,
      );
    }
    return adapter;
  }

  payments(): PaymentAdapter {
    return this.guard(new MockPayments());
  }
  kyc(): KycAdapter {
    return this.guard(new MockKyc());
  }
  creditBureau(): CreditBureauAdapter {
    return this.guard(new MockBureau());
  }
  notifications(): NotificationAdapter {
    return this.guard(new MockNotifications());
  }
  externalAccounting(): ExternalAccountingAdapter {
    return this.guard(new MockAccountingExport());
  }
  documents(): DocumentStorageAdapter {
    return this.guard(this.s3 ? new S3Documents() : new MockDocuments());
  }
  /** Auto-debit collection. Only the mock exists so far, so production refuses it. */
  bankDebit(): BankDebitAdapter {
    return this.guard(new MockBankDebit());
  }
  /**
   * The rate source for cross-currency payments: the tenant's own published
   * rate table (passed in by the caller, which holds the transaction), or the
   * mock feed when LENDING_FX_SOURCE=MOCK.
   */
  fxRates(rateTable: FxRateAdapter): FxRateAdapter {
    return this.guard(
      process.env.LENDING_FX_SOURCE === 'MOCK' ? new MockFxFeed() : rateTable,
    );
  }

  /** For the capability screen: which adapters are real here. */
  status() {
    const entry = (name: string, real: boolean) => ({
      name,
      real,
      usable: real || !this.production,
    });
    return {
      payments: entry('MOCK_PAYMENTS', false),
      kyc: entry('MOCK_KYC', false),
      creditBureau: entry('MOCK_CREDIT_BUREAU', false),
      notifications: entry('MOCK_NOTIFICATIONS', false),
      externalAccounting: entry('MOCK_EXTERNAL_ACCOUNTING', false),
      documents: entry(this.s3 ? 'S3' : 'MOCK_LOCAL_DISK', this.s3),
      bankDebit: entry('MOCK_BANK_DEBIT', false),
      fxRates:
        process.env.LENDING_FX_SOURCE === 'MOCK'
          ? entry('MOCK_FX_FEED', false)
          : entry('TENANT_RATE_TABLE', true),
    };
  }
}
