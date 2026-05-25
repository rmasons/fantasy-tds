import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminDb } from '$lib/firebase/admin';
import {
	fetchLeague,
	fetchRosters,
	fetchUsers,
	fetchMatchups,
	fetchTransactions,
	buildRosterInfoMap,
} from '$lib/sleeper';
import { computeForSeason } from '$lib/superlativesEngine';
import { getPlayers } from '$lib/server/players';

export interface StoredAwardEntry {
	ownerId?: string;   // Sleeper username — preferred; resolved to display name + avatar at render time
	teamName?: string;  // plain-text fallback for entries without a Sleeper account
	stat: string;
	sub?: string;
}

// Document shape: superlativeHistory/{leagueId}
// { seasons: { "2024": { big_hairy: { teamName, stat, sub? }, ... }, ... } }

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const { leagueId } = params;

	// Try the current leagueId first, then fall back one hop for new-season transitions.
	let doc = await adminDb.collection('superlativeHistory').doc(leagueId).get();
	if (!doc.exists) {
		try {
			const league = await fetchLeague(leagueId);
			if (league.previous_league_id) {
				doc = await adminDb.collection('superlativeHistory').doc(league.previous_league_id).get();
			}
		} catch {
			// ignore — return empty
		}
	}

	if (!doc.exists) return json({ history: [] });

	const raw = (doc.data()?.seasons ?? {}) as Record<string, Record<string, StoredAwardEntry>>;
	const history = Object.entries(raw)
		.map(([season, awards]) => ({ season, awards }))
		.sort((a, b) => b.season.localeCompare(a.season));

	return json({ history });
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	if (!locals.user.isAdmin) throw error(403, 'Forbidden');

	const { leagueId } = params;
	const body = await request.json().catch(() => null);

	if (
		!body ||
		typeof body.season !== 'string' ||
		!/^\d{4}$/.test(body.season) ||
		typeof body.awards !== 'object' ||
		Array.isArray(body.awards)
	) {
		throw error(400, 'Body must be { season: "YYYY", awards: { [key]: { teamName, stat } } }');
	}

	const awards: Record<string, StoredAwardEntry> = {};
	for (const [key, val] of Object.entries(body.awards as Record<string, unknown>)) {
		if (!val || typeof val !== 'object') continue;
		const v = val as Record<string, unknown>;
		const hasOwner = typeof v.ownerId === 'string';
		const hasName  = typeof v.teamName === 'string';
		if (!hasOwner && !hasName) continue;
		awards[key] = {
			...(hasOwner ? { ownerId: v.ownerId as string } : {}),
			...(hasName  ? { teamName: v.teamName as string } : {}),
			stat: typeof v.stat === 'string' ? v.stat : '',
			...(typeof v.sub === 'string' && v.sub ? { sub: v.sub } : {}),
		};
	}

	await adminDb
		.collection('superlativeHistory')
		.doc(leagueId)
		.set({ seasons: { [body.season]: awards } }, { merge: true });

	return json({ ok: true, season: body.season, count: Object.keys(awards).length });
};

// PUT — admin only: walk the league chain, compute stats from Sleeper matchup history,
// then merge stat+sub into Firestore (preserving any existing ownerId/teamName set via POST).
export const PUT: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	if (!locals.user.isAdmin) throw error(403, 'Forbidden');

	const { leagueId } = params;
	const playersData = await getPlayers();
	const docRef = adminDb.collection('superlativeHistory').doc(leagueId);

	// Walk backwards through the previous_league_id chain, collecting all leagues.
	const leagues: import('$lib/types').SleeperLeague[] = [];
	let cursor: string | null = leagueId;
	while (cursor) {
		const lg: import('$lib/types').SleeperLeague | null = await fetchLeague(cursor).catch(() => null);
		if (!lg) break;
		leagues.push(lg);
		cursor = lg.previous_league_id;
		if (leagues.length > 10) break; // guard against cycles
	}

	// Read existing Firestore doc so we can preserve manually set ownerId/teamName.
	const existingDoc = await docRef.get();
	const existingSeasons = (existingDoc.data()?.seasons ?? {}) as Record<string, Record<string, StoredAwardEntry>>;

	const seasonUpdates: Record<string, Record<string, StoredAwardEntry>> = {};
	const report: Array<{ season: string; computed: number }> = [];

	for (const league of leagues) {
		const season = league.season;

		// Only process regular + post seasons (skip pre-season).
		if (league.season_type === 'pre') continue;

		const playoffWeekStart: number = (league.settings as any).playoff_week_start ?? 15;
		const weeksToFetch = playoffWeekStart - 1;
		if (weeksToFetch < 1) continue;

		const [rosters, users] = await Promise.all([
			fetchRosters(league.league_id),
			fetchUsers(league.league_id),
		]);

		const rosterInfoMap = buildRosterInfoMap(rosters, users);
		const weeks = Array.from({ length: weeksToFetch }, (_, i) => i + 1);

		const [matchupWeeks, txWeeks] = await Promise.all([
			Promise.all(weeks.map(w => fetchMatchups(league.league_id, w).catch(() => []))),
			Promise.all(weeks.map(w => fetchTransactions(league.league_id, w).catch(() => []))),
		]);

		const computed = computeForSeason(league, rosters, rosterInfoMap, matchupWeeks, txWeeks, playersData);
		const existing = existingSeasons[season] ?? {};
		const merged: Record<string, StoredAwardEntry> = { ...existing };

		for (const [key, entry] of computed) {
			const prev = existing[key];
			if (prev) {
				// Preserve existing ownerId/teamName — only update stat + sub.
				merged[key] = {
					...prev,
					stat: entry.stat,
					...(entry.sub ? { sub: entry.sub } : {}),
				};
			} else {
				// No manual entry — write the full computed entry using user_id as ownerId.
				merged[key] = {
					...(entry.ownerId ? { ownerId: entry.ownerId } : { teamName: entry.teamName }),
					stat: entry.stat,
					...(entry.sub ? { sub: entry.sub } : {}),
				};
			}
		}

		seasonUpdates[season] = merged;
		report.push({ season, computed: computed.size });
	}

	if (Object.keys(seasonUpdates).length > 0) {
		await docRef.set({ seasons: seasonUpdates }, { merge: true });
	}

	return json({ ok: true, seasons: report });
};
