type Bucket = { timestamps: number[]; windowMs: number };
const buckets = new Map<string, Bucket>();

// Evict keys whose most-recent hit has aged past their own window
setInterval(() => {
	const now = Date.now();
	for (const [key, { timestamps, windowMs }] of buckets) {
		if (!timestamps.length || now - timestamps[timestamps.length - 1] >= windowMs) {
			buckets.delete(key);
		}
	}
}, 60_000).unref();

export function checkRateLimit(key: string, limit = 30, windowMs = 60_000): boolean {
	const now = Date.now();
	const kept = (buckets.get(key)?.timestamps ?? []).filter(t => now - t < windowMs);
	if (kept.length >= limit) {
		buckets.set(key, { timestamps: kept, windowMs });
		return false;
	}
	kept.push(now);
	buckets.set(key, { timestamps: kept, windowMs });
	return true;
}
