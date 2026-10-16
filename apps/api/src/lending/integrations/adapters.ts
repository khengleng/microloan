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
    };
  }
}
