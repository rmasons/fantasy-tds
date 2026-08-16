/**
 * Explain how a player's keeper cost is derived, straight from Sleeper.
 *
 * Walks the league lineage, prints every draft appearance of the matched
 * player(s) with Sleeper's `is_keeper` flag, then shows the keeper streak,
 * base cost and final keeper cost the app now computes.
 *
 * No Firebase needed — this reads Sleeper only, so it does NOT account for
 * admin overrides in keeperData/{leagueId}/players.
 *
 * Usage:
 *   node scripts/explain-keeper.mjs <leagueId> "Bucky Irving" "Cade Otton"
 *   node scripts/explain-keeper.mjs <leagueId>            # every rostered player
 */

const [leagueId, ...nameArgs] = process.argv.slice(2);
if (!leagueId) {
	console.error('Usage: node scripts/explain-keeper.mjs <leagueId> [player name...]');
	process.exit(1);
}

const get = async (path) => {
	const res = await fetch(`https://api.sleeper.app/v1${path}`);
	if (!res.ok) throw new Error(`Sleeper ${path} → ${res.status}`);
	return res.json();
};

// ── Formulas (mirror src/lib/keeperCost.ts) ────────────────────────────────────
const roundToBaseCost = (round) => Math.max(5, 80 - 5 * round);
const calcKeeperCost = (base, years) => Math.ceil((base < 1 ? 5 : base) * (1 + 0.2 * (years + 1)));

// ── Walk the lineage, keyed by season (mirrors walkDraftHistory) ───────────────
const history = {};   // season → playerId → { round, isKeeper, rosterId }
const seasonsSeen = [];
let currentId = leagueId;
let planningYear = null;

while (currentId && currentId !== '0') {
	const league = await get(`/league/${currentId}`);
	if (planningYear === null) planningYear = parseInt(league.season, 10);
	const season = league.season;

	const drafts = await get(`/league/${currentId}/drafts`).catch(() => []);
	for (const draft of drafts ?? []) {
		const picks = await get(`/draft/${draft.draft_id}/picks`).catch(() => null);
		if (picks === null) continue;
		const bySeason = (history[season] ??= {});
		for (const pick of picks) {
			if (!pick.player_id) continue;
			const isKeeper = pick.is_keeper === true;
			const existing = bySeason[pick.player_id];
			if (existing && !(existing.isKeeper && !isKeeper)) continue;
			bySeason[pick.player_id] = { round: pick.round, isKeeper, rosterId: pick.roster_id ?? null };
		}
	}
	if (!seasonsSeen.includes(season)) seasonsSeen.push(season);
	currentId = league.previous_league_id ?? null;
}

// ── Resolve keeper streak (mirrors src/lib/keeperHistory.ts) ───────────────────
function resolve(playerId) {
	let yearsKept = 0;
	let season = planningYear - 1;
	while (history[String(season)]?.[playerId]?.isKeeper) { yearsKept++; season--; }
	const key = String(season);
	const anchor = history[key]?.[playerId];
	return {
		yearsKept,
		draftRound: anchor && !anchor.isKeeper ? anchor.round : null,
		draftSeason: anchor && !anchor.isKeeper ? key : null,
		acquiredSeason: history[key] !== undefined ? key : null,
	};
}

// ── Report ────────────────────────────────────────────────────────────────────
const [rosters, users, players] = await Promise.all([
	get(`/league/${leagueId}/rosters`),
	get(`/league/${leagueId}/users`),
	fetch('https://api.sleeper.app/v1/players/nfl').then((r) => r.json()),
]);

const userName = new Map(
	users.map((u) => [u.user_id, u.metadata?.team_name || u.display_name || u.username || u.user_id]),
);
const wanted = nameArgs.map((n) => n.toLowerCase());

console.log(`League ${leagueId}  |  planning year ${planningYear}`);
console.log(`Seasons walked: ${seasonsSeen.join(', ')}\n`);

let hits = 0;
for (const roster of rosters) {
	for (const playerId of roster.players ?? []) {
		const p = players[playerId];
		const name = p ? `${p.first_name} ${p.last_name}` : playerId;
		if (wanted.length && !wanted.some((w) => name.toLowerCase().includes(w))) continue;
		hits++;

		const r = resolve(playerId);
		const base = r.draftRound !== null ? roundToBaseCost(r.draftRound) : 5;
		const cost = calcKeeperCost(base, r.yearsKept);

		console.log(`${name} (${p?.position ?? '?'})  —  ${userName.get(roster.owner_id) ?? `Roster ${roster.roster_id}`}`);
		for (const season of seasonsSeen) {
			const rec = history[season]?.[playerId];
			if (!rec) continue;
			console.log(`   ${season}: R${rec.round}${rec.isKeeper ? '  [KEEPER]' : '  (drafted)'}  roster ${rec.rosterId}`);
		}
		const acquired = r.draftSeason
			? `drafted R${r.draftRound} in ${r.draftSeason}`
			: r.acquiredSeason
				? `undrafted — waiver/FA add in ${r.acquiredSeason}`
				: 'acquisition predates the league history';
		console.log(`   → ${acquired}`);
		console.log(`   → years kept: ${r.yearsKept}   base $${base} × ${(1 + 0.2 * (r.yearsKept + 1)).toFixed(1)} = $${cost}\n`);
	}
}

if (wanted.length && hits === 0) console.log('No rostered player matched those names.');
