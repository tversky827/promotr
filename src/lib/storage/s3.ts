import { createHash, createHmac } from 'node:crypto';

import { integrations } from '@/lib/env';
import { logger } from '@/lib/observability/logger';

/**
 * S3-compatible object storage.
 *
 * AWS Signature V4 implemented directly rather than pulling in the AWS SDK,
 * which is ~15MB for the two operations this application needs (PUT an object,
 * presign a GET). Works against AWS S3, Cloudflare R2, Backblaze B2 and MinIO.
 */

export class StorageNotConfiguredError extends Error {
  readonly code = 'STORAGE_NOT_CONFIGURED';
  constructor(operation: string) {
    super(
      `Object storage is not configured; cannot ${operation}. Set S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.`,
    );
    this.name = 'StorageNotConfiguredError';
  }
}

export function storageConfigured(): boolean {
  return integrations.storage.configured;
}

function endpointFor(key: string): { url: URL; host: string } {
  const { endpoint, bucket, region, forcePathStyle } = integrations.storage;
  const base = endpoint || `https://s3.${region}.amazonaws.com`;
  const root = new URL(base);
  const url = forcePathStyle
    ? new URL(`${root.origin}/${bucket}/${key}`)
    : new URL(`${root.protocol}//${bucket}.${root.host}/${key}`);
  return { url, host: url.host };
}

export async function putObject(params: {
  key: string;
  body: Buffer | string;
  contentType: string;
  cacheControl?: string;
}): Promise<{ url: string; key: string }> {
  if (!storageConfigured()) throw new StorageNotConfiguredError('upload a file');

  const body = typeof params.body === 'string' ? Buffer.from(params.body) : params.body;
  const { url, host } = endpointFor(params.key);
  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = createHash('sha256').update(body).digest('hex');

  const headers: Record<string, string> = {
    host,
    'content-type': params.contentType,
    'content-length': String(body.length),
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...(params.cacheControl ? { 'cache-control': params.cacheControl } : {}),
  };

  const authorization = signV4({
    method: 'PUT',
    url,
    headers,
    payloadHash,
    amzDate,
    dateStamp,
  });

  const response = await fetch(url.toString(), {
    method: 'PUT',
    headers: { ...headers, Authorization: authorization },
    body: new Uint8Array(body),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    logger.error('storage.put_failed', { key: params.key, status: response.status, body: text.slice(0, 300) });
    throw new Error(`Object storage rejected the upload (HTTP ${response.status})`);
  }

  return { url: publicUrl(params.key), key: params.key };
}

export function publicUrl(key: string): string {
  const configured = integrations.storage.publicUrl;
  if (configured) return `${configured}/${key}`;
  return endpointFor(key).url.toString();
}

/**
 * Presigned GET. Used for CSV exports and private creative assets, which must
 * not be world-readable but do need to be fetchable by a browser.
 */
export function presignGetUrl(key: string, expiresInSeconds = 3600): string {
  if (!storageConfigured()) throw new StorageNotConfiguredError('generate a download link');

  const { url, host } = endpointFor(key);
  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const { accessKeyId, region } = integrations.storage;
  const credential = `${accessKeyId}/${dateStamp}/${region}/s3/aws4_request`;

  url.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
  url.searchParams.set('X-Amz-Credential', credential);
  url.searchParams.set('X-Amz-Date', amzDate);
  url.searchParams.set('X-Amz-Expires', String(expiresInSeconds));
  url.searchParams.set('X-Amz-SignedHeaders', 'host');

  const canonicalRequest = [
    'GET',
    url.pathname,
    canonicalQuery(url.searchParams),
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    `${dateStamp}/${region}/s3/aws4_request`,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  url.searchParams.set('X-Amz-Signature', sign(stringToSign, dateStamp));
  return url.toString();
}

export async function deleteObject(key: string): Promise<void> {
  if (!storageConfigured()) throw new StorageNotConfiguredError('delete a file');

  const { url, host } = endpointFor(key);
  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = createHash('sha256').update('').digest('hex');
  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  const authorization = signV4({ method: 'DELETE', url, headers, payloadHash, amzDate, dateStamp });

  const response = await fetch(url.toString(), {
    method: 'DELETE',
    headers: { ...headers, Authorization: authorization },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Object storage rejected the delete (HTTP ${response.status})`);
  }
}

function signV4(params: {
  method: string;
  url: URL;
  headers: Record<string, string>;
  payloadHash: string;
  amzDate: string;
  dateStamp: string;
}): string {
  const { region, accessKeyId } = integrations.storage;
  const sortedKeys = Object.keys(params.headers).sort();
  const canonicalHeaders = sortedKeys
    .map((k) => `${k.toLowerCase()}:${params.headers[k]!.trim()}\n`)
    .join('');
  const signedHeaders = sortedKeys.map((k) => k.toLowerCase()).join(';');

  const canonicalRequest = [
    params.method,
    params.url.pathname,
    canonicalQuery(params.url.searchParams),
    canonicalHeaders,
    signedHeaders,
    params.payloadHash,
  ].join('\n');

  const scope = `${params.dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    params.amzDate,
    scope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  const signature = sign(stringToSign, params.dateStamp);
  return `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

function sign(stringToSign: string, dateStamp: string): string {
  const { secretAccessKey, region } = integrations.storage;
  const kDate = createHmac('sha256', `AWS4${secretAccessKey}`).update(dateStamp).digest();
  const kRegion = createHmac('sha256', kDate).update(region).digest();
  const kService = createHmac('sha256', kRegion).update('s3').digest();
  const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
  return createHmac('sha256', kSigning).update(stringToSign).digest('hex');
}

function canonicalQuery(searchParams: URLSearchParams): string {
  const entries = [...searchParams.entries()]
    .filter(([k]) => k !== 'X-Amz-Signature')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries
    .map(([k, v]) => `${encodeRfc3986(k)}=${encodeRfc3986(v)}`)
    .join('&');
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

/** Namespaced key so unrelated uploads cannot collide or be guessed. */
export function storageKey(prefix: string, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  const stamp = new Date().toISOString().slice(0, 10);
  const random = createHash('sha256')
    .update(`${Date.now()}${Math.random()}`)
    .digest('base64url')
    .slice(0, 12);
  return `${prefix}/${stamp}/${random}-${safe}`;
}
