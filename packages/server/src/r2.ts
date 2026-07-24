// Thin write-only R2 client, used only by the cell compositor (see ROADMAP
// Phase 5 Stage 3): the server's first live write path to R2, everything else
// it does with R2 is a plain HTTPS read (the boot-time manifest fetch, and the
// compositor's own piece-tile reads) through the public CDN domain, needing no
// credentials. R2 speaks the S3 API, so the AWS SDK is the standard client
// (region "auto" plus a Cloudflare account endpoint), rather than hand-rolling
// SigV4 request signing.

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

export type R2WriteConfig = {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

export type R2Uploader = (key: string, body: Buffer, contentType: string) => Promise<void>;

export function createR2Uploader(cfg: R2WriteConfig): R2Uploader {
  const client = new S3Client({
    region: "auto",
    endpoint: cfg.endpoint,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
  return async (key, body, contentType) => {
    await client.send(
      new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  };
}
