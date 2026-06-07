import { describe, it, expect } from 'vitest';
import { computeForSeason } from './superlativesEngine';
import type { RosterInfo, RawMatchup } from './sleeper';
import type { SleeperLeague, SleeperRoster, SlimPlayer } from './types';

const league = { settings: { type: 0, playoff_teams: 4 } } as SleeperLeague;

const rosters = [
	{
		roster_id: 1,
		owner_id: 'u1',
		settings: { wins: 10, losses: 4, ties: 0, fpts: 1500, fpts_decimal: 0, fpts_against: 1400, fpts_against_decimal: 0 },
	},
	{
		roster_id: 2,
		owner_id: 'u2',
		settings: { wins: 4, losses: 10, ties: 0, fpts: 1200, fpts_decimal: 0, fpts_against: 1450, fpts_against_decimal: 0 },
	},
] as SleeperRoster[];

const rosterInfoMap = new Map<number, RosterInfo>([
	[1, { teamName: 'Alpha', ownerName: 'Alice', avatar: null, ownerId: 'u1' }],
	[2, { teamName: 'Beta', ownerName: 'Bob', avatar: null, ownerId: 'u2' }],
]);

// One week: roster 1 (150) beats roster 2 (100).
const matchupWeeks: RawMatchup[][] = [
	[
		{ roster_id: 1, matchup_id: 1, points: 150, starters: [], players: [], players_points: {} },
		{ roster_id: 2, matchup_id: 1, points: 100, starters: [], players: [], players_points: {} },
	],
];

const playersData: Record<string, SlimPlayer> = {};

describe('computeForSeason', () => {
	const result = computeForSeason(league, rosters, rosterInfoMap, matchupWeeks, [], playersData);

	it('awards the regular-season champion to the best record', () => {
		const e = result.get('big_hairy');
		expect(e?.teamName).toBe('Alpha');
		expect(e?.stat).toBe('10–4');
	});

	it('awards the biggest blowout win by margin', () => {
		const e = result.get('big_red');
		expect(e?.teamName).toBe('Alpha');
		expect(e?.stat).toBe('+50.00 pts');
	});

	it('awards the highest single-week score', () => {
		const e = result.get('hakuna');
		expect(e?.teamName).toBe('Alpha');
		expect(e?.stat).toBe('150.00 pts');
		expect(e?.sub).toBe('Week 1');
	});

	it('resolves ownerId from the roster info map', () => {
		expect(result.get('big_hairy')?.ownerId).toBe('u1');
	});
});
