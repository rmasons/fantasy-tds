// ─────────────────────────────────────────────────────────────────────────
// FAAB Easter Egg hunt — shared metadata.
//
// Single source of truth for the hidden $5-FAAB eggs scattered across the site.
// Imported by the claim API (validation), the egg component, the keepers hunt
// modal, and the /hunt tracker page so the egg count and IDs never drift apart.
//
// To RETIRE the hunt, see EASTER_EGG_REMOVAL.md at the repo root.
// ─────────────────────────────────────────────────────────────────────────

export interface EggClaim {
	claimedBy: string;
	displayName: string;
	claimedAt: string;
}

export type EggDifficulty = 'easy' | 'medium' | 'hard' | 'expert';

export interface EggMeta {
	id: string;
	/** Where it's hidden — revealed on the tracker only once the egg is claimed. */
	location: string;
	difficulty: EggDifficulty;
}

// Difficulty reflects how hard the badge is to notice in its hiding spot.
export const EGGS: EggMeta[] = [
	{ id: '1', location: 'Standings — Points Against column header', difficulty: 'medium' },
	{ id: '2', location: 'History — All-Time Lowest Scoring Matchups heading', difficulty: 'hard' },
	{ id: '3', location: 'Keepers — inside the salary formula', difficulty: 'medium' },
	{ id: '4', location: 'Matchups — Bracket tab', difficulty: 'medium' },
	{ id: '5', location: 'Power Rankings — Score column header', difficulty: 'medium' },
	{ id: '6', location: 'Draft Board — Round column header', difficulty: 'hard' },
	{ id: '7', location: 'Rosters — Bench label on the last team', difficulty: 'hard' },
	{ id: '8', location: 'Superlatives — last award description', difficulty: 'hard' },
	{ id: '9', location: 'History — All-Time Champions (2024 season only)', difficulty: 'expert' },
	{ id: '10', location: 'Managers — faint "sorted by all-time record" footer', difficulty: 'expert' },
	{ id: '11', location: 'Blog — "All" category filter', difficulty: 'easy' },
	{ id: '12', location: 'Home — Week matchups heading', difficulty: 'easy' },
	{ id: '13', location: 'Latest blog post — banner', difficulty: 'easy' },
];

export const EGG_IDS = new Set(EGGS.map((e) => e.id));
export const TOTAL_EGGS = EGGS.length;
export const MAX_CLAIMS_PER_USER = 3;

const EGG_BY_ID = new Map(EGGS.map((e) => [e.id, e]));
export function eggMeta(id: string): EggMeta | undefined {
	return EGG_BY_ID.get(id);
}

export const DIFFICULTY_LABEL: Record<EggDifficulty, string> = {
	easy: 'Easy',
	medium: 'Medium',
	hard: 'Hard',
	expert: 'Expert',
};

export const DIFFICULTY_ORDER: EggDifficulty[] = ['easy', 'medium', 'hard', 'expert'];
