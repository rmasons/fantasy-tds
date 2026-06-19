import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { list } from '@vercel/blob';
import { env } from '$env/dynamic/private';
import { redis } from '$lib/server/redis';
import { adminDb } from '$lib/firebase/admin';

// Unauthenticated liveness probe for the storage backends, so Redis / Blob /
// Firestore can be verified with a single request (and wired to uptime checks).
// Returns 200 only when every (non-skipped) check passes, else 503.
// Skip checks with ?skip=firestore,blob — e.g. to avoid a Firestore read on
// frequent polls. No secrets are returned.

type CheckResult = { ok: boolean; latencyMs: number; error?: string };

async function timed(fn: () => Promise<void>): Promise<CheckResult> {
	const start = Date.now();
	try {
		await fn();
		return { ok: true, latencyMs: Date.now() - start };
	} catch (e) {
		return { ok: false, latencyMs: Date.now() - start, error: e instanceof Error ? e.message : String(e) };
	}
}

const checkRedis = () =>
	timed(async () => {
		const pong = await redis().ping();
		if (pong !== 'PONG') throw new Error(`unexpected ping response: ${pong}`);
	});

const checkBlob = () =>
	timed(async () => {
		// Cheapest authenticated round-trip that proves the token + store work.
		await list({ limit: 1, token: env.BLOB_READ_WRITE_TOKEN });
	});

const checkFirestore = () =>
	timed(async () => {
		// One small read — also reflects the daily read-quota state.
		await adminDb().collection('config').doc('app').get();
	});

const PROBES: Record<string, () => Promise<CheckResult>> = {
	redis: checkRedis,
	blob: checkBlob,
	firestore: checkFirestore,
};

export const GET: RequestHandler = async ({ url }) => {
	const skip = new Set(
		(url.searchParams.get('skip') ?? '')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean)
	);

	const names = Object.keys(PROBES).filter((n) => !skip.has(n));
	const results = await Promise.all(names.map((n) => PROBES[n]()));
	const checks = Object.fromEntries(names.map((n, i) => [n, results[i]]));

	const ok = Object.values(checks).every((c) => c.ok);
	return json(
		{ ok, checks, time: new Date().toISOString() },
		{ status: ok ? 200 : 503, headers: { 'cache-control': 'no-store' } }
	);
};
