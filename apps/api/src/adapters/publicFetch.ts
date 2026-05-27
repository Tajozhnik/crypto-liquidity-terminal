/**
 * Shared TTL cache + rate-limit aware fetch wrapper for public exchange APIs.
 *
 * - In-memory TTL cache (no external dependency).
 * - Honours timeouts via AbortController.
 * - Honours backoff windows when the upstream returns 418/429/5xx; subsequent
 *   calls return the last cached value (or null) until the backoff expires.
 * - No API keys are required; per the project's no-subscription policy, this
 *   wrapper never adds Authorization headers.
 */

import { logger } from "../logger.js";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const backoffUntil = new Map<string, number>();

export interface PublicFetchOptions {
  /** Cache key — usually the full URL */
  key: string;
  url: string;
  /** Cache TTL in seconds. Defaults to env value. */
  ttlSeconds: number;
  /** Hard request timeout in ms. */
  timeoutMs: number;
}

export async function publicFetch<T>(opts: PublicFetchOptions): Promise<T | null> {
  const now = Date.now();

  const cached = cache.get(opts.key) as CacheEntry<T> | undefined;
  if (cached && cached.expiresAt > now) return cached.value;

  const cooldown = backoffUntil.get(opts.key);
  if (cooldown && cooldown > now) {
    return cached?.value ?? null;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  try {
    const res = await fetch(opts.url, { signal: ctrl.signal });
    if (res.status === 429 || res.status === 418 || res.status === 403 || (res.status >= 500 && res.status < 600)) {
      const retryAfterRaw = res.headers.get("retry-after");
      const retryAfterMs = retryAfterRaw ? Number.parseInt(retryAfterRaw, 10) * 1000 : 30_000;
      backoffUntil.set(opts.key, now + retryAfterMs);
      logger.warn(
        { url: opts.url, status: res.status, retryAfterMs },
        "Public API rate-limited; backing off and serving cache",
      );
      return cached?.value ?? null;
    }
    if (!res.ok) {
      logger.warn({ url: opts.url, status: res.status }, "Public API returned non-OK; using cache");
      return cached?.value ?? null;
    }
    const data = (await res.json()) as T;
    cache.set(opts.key, { value: data, expiresAt: now + opts.ttlSeconds * 1000 });
    return data;
  } catch (err) {
    logger.warn(
      { url: opts.url, err: (err as Error).message },
      "Public API fetch failed; using cache (or null)",
    );
    return cached?.value ?? null;
  } finally {
    clearTimeout(timer);
  }
}

/** Test-only helper. */
export function _resetPublicFetchState(): void {
  cache.clear();
  backoffUntil.clear();
}
