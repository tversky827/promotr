import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import { takeInlineExport } from '@/lib/analytics/exports';
import { logger } from '@/lib/observability/logger';

/**
 * Export download.
 *
 * Used when object storage is not configured: the CSV never left the
 * application, so the application has to serve it. With S3 configured the job's
 * `fileUrl` is a presigned link and the browser goes straight there — this
 * route is then only a fallback for a link whose signature has expired.
 *
 * An export contains a brand's or a publisher's full event history, so it is
 * bound to the user who requested it. Not to their brand, not to their role:
 * the exact account. A leaked job id therefore downloads nothing.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return new Response('Sign in to download this export.', { status: 401 });
  }

  const { id } = await context.params;
  const job = await prisma.exportJob.findUnique({ where: { id } });

  // The same response for "does not exist" and "belongs to someone else", so
  // the route cannot be used to probe for valid job ids.
  if (!job || job.userId !== session.user.id) {
    return new Response('That export was not found.', { status: 404 });
  }

  if (job.status !== 'ready') {
    return new Response(
      job.status === 'failed'
        ? `This export failed: ${job.errorMessage ?? 'unknown error'}`
        : 'This export is still being generated. Refresh in a moment.',
      { status: 409 },
    );
  }

  if (job.expiresAt && job.expiresAt.getTime() < Date.now()) {
    return new Response('This export has expired. Request a new one.', { status: 410 });
  }

  // Storage-backed exports redirect to the presigned URL rather than proxying
  // the bytes through the application.
  if (job.storageKey && job.fileUrl?.startsWith('http')) {
    return Response.redirect(job.fileUrl, 302);
  }

  const inline = takeInlineExport(job.id);
  if (!inline) {
    logger.warn('export.download_unavailable', { exportJobId: job.id });
    return new Response(
      'This export is no longer held in memory — it was generated before the last restart, ' +
        'and this deployment has no object storage configured. Request it again.',
      { status: 410 },
    );
  }

  return new Response(inline.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${inline.filename}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
