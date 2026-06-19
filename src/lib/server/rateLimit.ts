import { Ratelimit } from '@upstash/ratelimit';
import { redis } from '$lib/server/redis';

// Upstash-backed sliding-window limiter. Shared across serverless instances (so
// limits hold no matter which instance serves a request) but, unlike the old
// Firestore version, it costs no Firestore reads/writes and self-expires keys —
// no TTL policy to maintain. Limiter instances are memoized per (limit, window)
// so repeated calls reuse one client.

const limiters = new Map<string, Ratelimit>();

function limiterFor(limit: number, windowMs: number): Ratelimit {
	const cacheKey = `${limit}:${windowMs}`;
	let rl = limiters.get(cacheKey);
	if (!rl) {
		rl = new Ratelimit({
			redis: redis(),
			limiter: Ratelimit.slidingWindow(limit, `${windowMs} ms`),
			// Keys are namespaced so they can't collide with cache envelopes.
			prefix: 'ratelimit',
			analytics: false,
		});
		limiters.set(cacheKey, rl);
	}
	return rl;
}

export async function checkRateLimit(key: string, limit = 30, windowMs = 60_000): Promise<boolean> {
	try {
		const { success } = await limiterFor(limit, windowMs).limit(key.replace(/[^\w-]/g, '_'));
		return success;
	} catch {
		// Fail open: a Redis hiccup shouldn't lock out legitimate traffic.
		return true;
	}
}
