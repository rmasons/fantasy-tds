export interface NflTeam {
	abbr: string;
	name: string;
}

export const NFL_TEAMS: NflTeam[] = [
	{ abbr: 'ARI', name: 'Arizona Cardinals' },
	{ abbr: 'ATL', name: 'Atlanta Falcons' },
	{ abbr: 'BAL', name: 'Baltimore Ravens' },
	{ abbr: 'BUF', name: 'Buffalo Bills' },
	{ abbr: 'CAR', name: 'Carolina Panthers' },
	{ abbr: 'CHI', name: 'Chicago Bears' },
	{ abbr: 'CIN', name: 'Cincinnati Bengals' },
	{ abbr: 'CLE', name: 'Cleveland Browns' },
	{ abbr: 'DAL', name: 'Dallas Cowboys' },
	{ abbr: 'DEN', name: 'Denver Broncos' },
	{ abbr: 'DET', name: 'Detroit Lions' },
	{ abbr: 'GB',  name: 'Green Bay Packers' },
	{ abbr: 'HOU', name: 'Houston Texans' },
	{ abbr: 'IND', name: 'Indianapolis Colts' },
	{ abbr: 'JAX', name: 'Jacksonville Jaguars' },
	{ abbr: 'KC',  name: 'Kansas City Chiefs' },
	{ abbr: 'LAC', name: 'Los Angeles Chargers' },
	{ abbr: 'LAR', name: 'Los Angeles Rams' },
	{ abbr: 'LV',  name: 'Las Vegas Raiders' },
	{ abbr: 'MIA', name: 'Miami Dolphins' },
	{ abbr: 'MIN', name: 'Minnesota Vikings' },
	{ abbr: 'NE',  name: 'New England Patriots' },
	{ abbr: 'NO',  name: 'New Orleans Saints' },
	{ abbr: 'NYG', name: 'New York Giants' },
	{ abbr: 'NYJ', name: 'New York Jets' },
	{ abbr: 'PHI', name: 'Philadelphia Eagles' },
	{ abbr: 'PIT', name: 'Pittsburgh Steelers' },
	{ abbr: 'SEA', name: 'Seattle Seahawks' },
	{ abbr: 'SF',  name: 'San Francisco 49ers' },
	{ abbr: 'TB',  name: 'Tampa Bay Buccaneers' },
	{ abbr: 'TEN', name: 'Tennessee Titans' },
	{ abbr: 'WAS', name: 'Washington Commanders' },
];

export function teamAbbrByName(fullName: string): string | null {
	const lower = fullName.toLowerCase().trim();
	return NFL_TEAMS.find(t => t.name.toLowerCase() === lower)?.abbr ?? null;
}

export function teamLogoUrl(abbr: string): string {
	return `https://sleepercdn.com/images/team_logos/nfl/${abbr.toLowerCase()}.png`;
}

export function playerThumbUrl(sleeperPlayerId: string): string {
	return `https://sleepercdn.com/content/nfl/players/thumb/${sleeperPlayerId}.jpg`;
}
