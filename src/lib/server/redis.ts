import { Redis } from '@upstash/redis';
import { env } from '$env/dynamic/private';

let _redis: Redis | null = null;

/**
 * Lazily-initialized, memoized Upstash Redis client (REST transport, safe in
 * serverless). Backs the read-through cache layer in `cache.ts`. Provisioned via
 * the Vercel Marketplace Upstash integration.
 *
 * The integration injects the REST credentials under either the UPSTASH_* names
 * or the KV-compatible KV_REST_API_* names depending on how it was connected, so
 * accept both.
 */
export function redis(): Redis {
	if (_redis) return _redis;
	const url = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL;
	const token = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN;
	if (!url || !token) {
		throw new Error(
			'Upstash Redis is not configured. Set UPSTASH_REDIS_REST_URL / ' +
			'UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL / KV_REST_API_TOKEN), ' +
			'or set CACHE_BACKEND=firestore to fall back.'
		);
	}
	return (_redis = new Redis({ url, token }));
}
