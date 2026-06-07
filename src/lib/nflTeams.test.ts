import { describe, it, expect } from 'vitest';
import { teamAbbrByName, teamLogoUrl, playerThumbUrl } from './nflTeams';

describe('teamAbbrByName', () => {
	it('resolves a full team name to its abbreviation (case-insensitive)', () => {
		expect(teamAbbrByName('Kansas City Chiefs')).toBe('KC');
		expect(teamAbbrByName('  baltimore ravens  ')).toBe('BAL');
	});

	it('returns null for an unknown name', () => {
		expect(teamAbbrByName('London Monarchs')).toBeNull();
		expect(teamAbbrByName('')).toBeNull();
	});
});

describe('teamLogoUrl', () => {
	it('builds a lowercase logo URL', () => {
		expect(teamLogoUrl('KC')).toBe('https://sleepercdn.com/images/team_logos/nfl/kc.png');
	});
});

describe('playerThumbUrl', () => {
	it('builds a player thumbnail URL', () => {
		expect(playerThumbUrl('4881')).toBe('https://sleepercdn.com/content/nfl/players/thumb/4881.jpg');
	});
});
