import { S3Client } from '@aws-sdk/client-s3';
import { s3Settings } from './s3';

describe('s3Settings', () => {
  it('lets production boot without S3: the unused clients still get a region', async () => {
    const s3 = s3Settings({ NODE_ENV: 'production' });
    expect(s3.configured).toBe(false);
    const client = new S3Client({
      region: s3.region,
      credentials: s3.credentials,
    });
    await expect(client.config.region()).resolves.toBeTruthy();
  });

  it('gives production S3 no default region (runtime-config refuses to boot)', () => {
    const s3 = s3Settings({
      NODE_ENV: 'production',
      AWS_ACCESS_KEY_ID: 'id',
      AWS_SECRET_ACCESS_KEY: 'secret',
      AWS_S3_BUCKET_NAME: 'bucket',
    });
    expect(s3.configured).toBe(true);
    expect(s3.region).toBe('');
  });

  it('uses the named region', () => {
    expect(
      s3Settings({ NODE_ENV: 'production', AWS_REGION: 'ap-southeast-1' })
        .region,
    ).toBe('ap-southeast-1');
  });
});
