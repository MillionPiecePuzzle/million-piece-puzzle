// Thin write-only R2 client, used only by the cell compositor (see ROADMAP
// Phase 5 Stage 3): the server's first live write path to R2, everything else
// it does with R2 is a plain HTTPS read (the boot-time manifest fetch, and the
// compositor's own piece-tile reads) through the public CDN domain, needing no
// credentials. R2 speaks the S3 API, so the AWS SDK is the standard client
// (region "auto" plus a Cloudflare account endpoint), rather than hand-rolling
// SigV4 request signing.

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";

export type R2WriteConfig = {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

export type R2Client = {
  upload: (key: string, body: Buffer, contentType: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
  // Bulk delete for a board reset's cell-composite cleanup (see
  // CellCompositor.clearAll): pages through every object under the prefix
  // instead of one key at a time. ListObjectsV2's own page size already caps
  // at 1000, matching DeleteObjects' own per-call limit, so each page maps to
  // exactly one delete call.
  removeByPrefix: (prefix: string) => Promise<void>;
};

export function createR2Client(cfg: R2WriteConfig): R2Client {
  const client = new S3Client({
    region: "auto",
    endpoint: cfg.endpoint,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
  return {
    upload: async (key, body, contentType) => {
      await client.send(
        new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: body, ContentType: contentType }),
      );
    },
    remove: async (key) => {
      await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
    },
    removeByPrefix: async (prefix) => {
      let continuationToken: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({
            Bucket: cfg.bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          }),
        );
        const objects = (page.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
        if (objects.length > 0) {
          const result = await client.send(
            new DeleteObjectsCommand({ Bucket: cfg.bucket, Delete: { Objects: objects } }),
          );
          if (result.Errors && result.Errors.length > 0) {
            console.error(
              `[r2] removeByPrefix ${prefix}: ${result.Errors.length} object(s) failed to delete`,
              result.Errors,
            );
          }
        }
        continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (continuationToken);
    },
  };
}
