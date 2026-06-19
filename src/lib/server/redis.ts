import { Redis } from '@upstash/redis';
import { env } from '$env/dynamic/private';

let _redis: Redis | null = null;

/**
 * Lazily-initialized, memoized Upstash Redis client (REST transport, safe in
 * serverless). Backs the read-through cache layer in `cache.ts`. Provisioned via
 * the Vercel Marketplace Upstash integration, which injects the two env vars.
 */
export function redis(): Redis {
	if (_redis) return _redis;
	const url = env.UPSTASH_REDIS_REST_URL;
	const token = env.UPSTASH_REDIS_REST_TOKEN;
	if (!url || !token) {
		throw new Error(
			'Upstash Redis is not configured. Set UPSTASH_REDIS_REST_URL and ' +
			'UPSTASH_REDIS_REST_TOKEN (or set CACHE_BACKEND=firestore to fall back).'
		);
	}
	return (_redis = new Redis({ url, token }));
}
