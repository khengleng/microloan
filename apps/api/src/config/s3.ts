/**
 * Object storage settings, read in one place for the three S3 clients
 * (document vault, lending integration documents, customer document library).
 *
 * S3 is in use only when the access key, secret and bucket are all set.
 * Production must name the region (checked at boot in runtime-config.ts);
 * outside production an unset region falls back to the AWS SDK's usual
 * default so a developer bucket works without extra setup.
 */
export interface S3Settings {
  configured: boolean;
  region: string;
  bucket: string;
  credentials: { accessKeyId: string; secretAccessKey: string };
}

const DEVELOPMENT_REGION = 'us-east-1';

export function s3Settings(env: NodeJS.ProcessEnv = process.env): S3Settings {
  const accessKeyId = env.AWS_ACCESS_KEY_ID?.trim() ?? '';
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY?.trim() ?? '';
  const bucket = env.AWS_S3_BUCKET_NAME?.trim() ?? '';
  const region =
    env.AWS_REGION?.trim() ||
    (env.NODE_ENV === 'production' ? '' : DEVELOPMENT_REGION);
  return {
    configured: !!(accessKeyId && secretAccessKey && bucket),
    region,
    bucket,
    credentials: { accessKeyId, secretAccessKey },
  };
}
