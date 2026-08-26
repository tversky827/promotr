/**
 * Runs once at server start, before any request is handled.
 *
 * Two jobs: fail fast on invalid production configuration, and log what the
 * deployment can actually do. An operator should be able to read the first lines
 * of the log and know whether payments and email will work.
 */
export async function register(): Promise<void> {
  const { assertConfigured, env, integrationStatus } = await import('@/lib/env');
  const { logger } = await import('@/lib/observability/logger');

  try {
    assertConfigured();
  } catch (error) {
    logger.error('boot.configuration_invalid', { error: (error as Error).message });
    // Refusing to boot is correct: a production server missing its encryption
    // key would silently write unrecoverable data.
    throw error;
  }

  const status = integrationStatus();
  logger.info('boot.ready', {
    nodeEnv: env.nodeEnv,
    appUrl: env.appUrl,
    trackingUrl: env.trackingUrl,
    integrations: status,
  });

  const unconfigured = Object.entries(status)
    .filter(([, value]) => !value.configured)
    .map(([name]) => name);

  if (unconfigured.length > 0) {
    logger.warn('boot.integrations_unconfigured', {
      unconfigured,
      detail:
        'Features backed by these integrations report an explicit "not configured" state rather than failing silently. See docs/LAUNCH.md.',
    });
  }
}

export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
): Promise<void> {
  const { captureException } = await import('@/lib/observability/sentry');
  captureException(error, { route: request.path, method: request.method });
}
