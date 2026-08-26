/**
 * Module resolution for the standalone Node entry points (the worker and the
 * seed script).
 *
 * Next.js resolves the `@/*` path alias and extensionless imports for the web
 * application, but `node scripts/worker.ts` gets neither: ES modules require a
 * full specifier, and Node knows nothing about tsconfig paths. Rather than add
 * a bundler or a runtime dependency for two entry points, this registers
 * Node's own synchronous resolve hook and applies the same two rules the
 * TypeScript compiler does.
 *
 * Used as `node --experimental-transform-types --import ./scripts/ts-runtime.mjs …`.
 */
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const projectRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '/index.ts', '/index.tsx'];

/** Returns the first candidate file that exists, or null when none do. */
function firstExisting(basePath) {
  if (existsSync(basePath) && !basePath.endsWith('/')) {
    // A directory matches `existsSync` too, so only accept a real file path.
    if (/\.[cm]?[jt]sx?$/.test(basePath)) return basePath;
  }
  for (const extension of SOURCE_EXTENSIONS) {
    const candidate = basePath + extension;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    // tsconfig path alias: `@/lib/db` -> `<root>/src/lib/db`.
    if (specifier.startsWith('@/')) {
      const resolved = firstExisting(resolvePath(projectRoot, 'src', specifier.slice(2)));
      if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true };
    }

    // Extensionless relative import, as TypeScript source is normally written.
    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      const parentPath = context.parentURL?.startsWith('file:')
        ? dirname(fileURLToPath(context.parentURL))
        : projectRoot;
      const resolved = firstExisting(resolvePath(parentPath, specifier));
      if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true };
    }

    return nextResolve(specifier, context);
  },
});
