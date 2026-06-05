export interface UserProfile {
	uid: string;
	email: string;
	sleeperUserId: string | null;
	sleeperUsername: string | null;
	/** leagueId of the last league the user viewed */
	lastLeagueId: string | null;
	/** Set manually in Firestore to grant admin panel access */
	isAdmin?: boolean;
}

export interface SleeperUser {
	user_id: string;
	username: string;
	display_name: string;
	avatar: string | null;
}

export interface SleeperLeague {
	league_id: string;
	name: string;
	season: string;
	season_type: string;
	sport: string;
	status: string;
	total_rosters: number;
	previous_league_id: string | null;
	roster_positions?: string[]; // e.g. ['QB', 'WR', 'RB', 'TE', 'FLEX', 'K', 'DEF', 'BN', ...]
	settings: {
		type: number; // 0=redraft, 2=dynasty
		playoff_week_start?: number;
		playoff_round_type?: number; // 0=1-week, 2=2-week rounds
		playoff_teams?: number;
	};
	avatar: string | null;
}

export interface SlimPlayer {
	name: string;
	pos: string;
	team: string;
	yearsExp: number; // NFL years of experience (0 = rookie)
	number?: number;  // jersey number; absent for DEF/ST and some inactive players
}

export interface SleeperNflState {
	week: number;
	season: string;
	season_type: 'pre' | 'regular' | 'post';
	display_week: number;
}

export interface SleeperRoster {
	roster_id: number;
	owner_id: string;
	co_owners: string[] | null;
	players: string[] | null;   // all rostered player IDs
	reserve: string[] | null;   // IR slot player IDs
	settings: {
		wins: number;
		losses: number;
		ties: number;
		fpts: number;
		fpts_decimal: number;
		fpts_against: number;
		fpts_against_decimal: number;
		division?: number;
	};
	metadata?: {
		streak?: string;
		record?: string;
	};
}

export interface SleeperLeagueUser {
	user_id: string;
	username: string;
	display_name: string;
	avatar: string | null;
	metadata?: {
		team_name?: string;
		avatar?: string;
	};
}

export interface SleeperBracketMatch {
	r: number;                              // round number
	m: number;                              // match id within the bracket
	t1: number | null;                      // roster_id of team 1 (null until resolved)
	t2: number | null;                      // roster_id of team 2
	w: number | null;                       // roster_id of the winner
	l: number | null;                       // roster_id of the loser
	t1_from?: { w?: number; l?: number };   // which prior match feeds slot t1
	t2_from?: { w?: number; l?: number };
	p?: number;                             // placement this match decides (1 = championship)
}

export interface SleeperTransactionDraftPick {
	season: string;
	round: number;
	roster_id: number;          // roster that originally owned the pick
	previous_owner_id: number;
	owner_id: number;           // roster_id receiving the pick
}

export interface SleeperTransaction {
	transaction_id: string;
	type: string;               // 'trade' | 'waiver' | 'free_agent' | 'commissioner'
	status: string;             // 'complete' | 'failed' | 'pending'
	status_updated: number;     // epoch ms
	created: number;            // epoch ms
	leg: number;                // week
	roster_ids: number[];
	consenter_ids?: number[] | null;
	adds: Record<string, number> | null;   // player_id → roster_id
	drops: Record<string, number> | null;
	draft_picks: SleeperTransactionDraftPick[];
	waiver_budget: { sender: number; receiver: number; amount: number }[];
	settings: { waiver_bid?: number; seq?: number } | null;
	metadata: { notes?: string } | null;
	creator: string;
}

export interface SleeperDraft {
	draft_id: string;
	league_id: string;
	status: string;             // 'complete' | 'drafting' | 'pre_draft' | 'paused'
	type: string;               // 'snake' | 'auction' | 'linear'
	season: string;
	season_type: string;
	start_time: number;
	created: number;
	draft_order: Record<string, number> | null;       // user_id → draft slot
	slot_to_roster_id: Record<string, number> | null; // slot → roster_id
	settings: {
		rounds: number;
		teams: number;
		[key: string]: number | undefined;
	};
	metadata?: Record<string, string>;
}

export interface SleeperDraftPick {
	draft_id: string;
	pick_no: number;
	round: number;
	draft_slot: number;
	roster_id: number;
	player_id: string;
	picked_by: string;          // user_id
	is_keeper: boolean | null;
	metadata?: Record<string, string | undefined>;
}

export interface StandingRow {
	rank: number;
	rosterId: number;
	teamName: string;
	ownerName: string | null;
	avatar: string | null;
	wins: number;
	losses: number;
	ties: number;
	fpts: number;
	fptsAgainst: number;
	streak: string;
}

export interface ManagerProfile {
	sleeperUserId: string;
	displayName?: string;     // max 50 chars — shown across the app instead of Sleeper username
	firstName?: string;       // max 50 chars
	lastName?: string;        // max 50 chars
	email?: string;           // written automatically on first login
	bio?: string;             // max 280 chars
	location?: string;        // max 60 chars
	favoriteNFLTeam?: string;  // max 60 chars — full team name, e.g. "Kansas City Chiefs"
	favoritePlayer?: string;   // max 60 chars — player display name
	favoritePlayerId?: string; // max 10 chars — Sleeper player ID for photo lookup
	preferredContact?: string; // max 60 chars — how to reach this person
	updatedAt?: number;
}

export interface ManagerLeagueProfile {
	leagueId: string;
	joinedYear?: number;
	updatedAt?: number;
}

export interface RosterSummary {
	ownerId: string;
	teamName: string;
	ownerName: string | null;
	avatar: string | null;
	wins: number;
	losses: number;
	ties: number;
	fpts: number;
	fptsAgainst: number;
}

export interface RecordGame {
	season: string;
	week: number;
	winner: string;
	loser: string;
	winnerPts: number;
	loserPts: number;
	diff: number;
	winnerId?: string;
	loserId?: string;
}

export interface RecordScore {
	season: string;
	week: number;
	team: string;
	pts: number;
	ownerId?: string;
}

export interface SeasonRecords {
	leagueId: string;
	season: string;
	status: string;
	previousLeagueId: string | null;
	playoffWeekStart: number;
	rosterSummaries: RosterSummary[];
	gameResults: RecordGame[];
	weekHighs: RecordScore[];
	weekLows: RecordScore[];
}
