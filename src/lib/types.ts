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
	favoriteNFLTeam?: string; // max 60 chars
	favoritePlayer?: string;  // max 60 chars
	funFact?: string;         // max 200 chars
	twitterHandle?: string;   // max 50 chars, no @ prefix stored
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
