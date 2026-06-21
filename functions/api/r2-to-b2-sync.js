// CF Pages Function: r2-to-b2-sync
// POST (no body required) — incremental R2 → B2 backup sync.
// Scheduled nightly via a CF Worker Cron Trigger that POSTs to /api/r2-to-b2-sync.
// Only runs when B2 credentials are present (skips silently on dev).

import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { verifyAuth } from './_helpers.js';

function makeR2Client(env) {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId:     env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });
}

function makeB2Client(env) {
  return new S3Client({
    region: env.B2_ENDPOINT.split('.')[1],
    endpoint: `https://${env.B2_ENDPOINT}`,
    credentials: {
      accessKeyId:     env.B2_KEY_ID,
      secretAccessKey: env.B2_APPLICATION_KEY,
    },
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const auth = await verifyAuth(request, env, 'admin', 'uploads');
  if (auth.httpError) return new Response(auth.httpError.message, { status: auth.httpError.status });

  if (!env.B2_KEY_ID || !env.B2_APPLICATION_KEY) {
    console.log('[r2-to-b2-sync] B2 credentials not set — skipping');
    return new Response('Skipped — no B2 credentials', { status: 200 });
  }

  const r2       = makeR2Client(env);
  const b2       = makeB2Client(env);
  const r2Bucket = env.R2_BUCKET_NAME;
  const b2Bucket = env.B2_BUCKET_NAME;

  let synced = 0, skipped = 0, failed = 0;
  let continuationToken;

  do {
    const listResult = await r2.send(new ListObjectsV2Command({
      Bucket: r2Bucket,
      ContinuationToken: continuationToken,
    }));

    for (const obj of listResult.Contents || []) {
      const key = obj.Key;

      if (key.startsWith('pending/')) { skipped++; continue; }

      try {
        try {
          const head = await b2.send(new HeadObjectCommand({ Bucket: b2Bucket, Key: key }));
          if (head.ETag === obj.ETag) { skipped++; continue; }
        } catch (_) {
          // Not in B2 yet — fall through to copy
        }

        const { Body, ContentType } = await r2.send(
          new GetObjectCommand({ Bucket: r2Bucket, Key: key })
        );

        await b2.send(new PutObjectCommand({
          Bucket: b2Bucket,
          Key: key,
          Body,
          ContentType,
          ContentLength: obj.Size,
        }));

        synced++;
        console.log(`[sync] copied: ${key}`);
      } catch (err) {
        failed++;
        console.error(`[sync] FAILED: ${key} — ${err.message}`);
      }
    }

    continuationToken = listResult.NextContinuationToken;
  } while (continuationToken);

  const summary = `R2→B2 sync: ${synced} copied, ${skipped} skipped, ${failed} failed`;
  console.log(summary);
  return new Response(summary, { status: 200 });
}
