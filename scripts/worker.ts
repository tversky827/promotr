/**
 * Background worker entry point.
 *
 *   npm run worker
 *
 * Run at least one of these alongside the web application in production. See
 * docs/DEPLOYMENT.md for process-manager and container examples.
 */
import { runWorker } from '../src/lib/jobs/worker';

const queues = process.env.WORKER_QUEUES?.split(',').map((q) => q.trim()).filter(Boolean);

void runWorker({ ...(queues && queues.length > 0 ? { queues } : {}) });
