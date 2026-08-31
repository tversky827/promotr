/**
 * Whether DATABASE_URL points at a throwaway local database.
 *
 * Both seeds refuse to write into anything else without an explicit opt-in, so
 * this decides whether sample data can land in front of real users. It parses
 * the URL and reads the hostname rather than pattern-matching the string: a
 * connection string usually carries the username `postgres`, and a check loose
 * enough to match that would wave through every remote database owned by a
 * user of that name.
 */
export function targetsLocalDatabase(url = process.env.DATABASE_URL ?? ''): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    // `db` and `postgres` are the service names Compose and Kubernetes use.
    return ['localhost', '127.0.0.1', '::1', 'db', 'postgres'].includes(host);
  } catch {
    // A unix socket path or an unparseable URL is local by definition.
    return url === '' || url.startsWith('postgres://:') || url.includes('/var/run/');
  }
}
