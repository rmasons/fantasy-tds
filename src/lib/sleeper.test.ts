import { describe, it, expect } from 'vitest';
import { avatarUrl, combineFpts, buildRosterInfoMap } from './sleeper';
import type { SleeperRoster, SleeperLeagueUser } from './types';

describe('avatarUrl', () => {
	it('returns null for empty input', () => {
		expect(avatarUrl(null)).toBeNull();
		expect(avatarUrl(undefined)).toBeNull();
		expect(avatarUrl('')).toBeNull();
	});

	it('passes through full URLs unchanged', () => {
		expect(avatarUrl('https://example.com/a.png')).toBe('https://example.com/a.png');
	});

	it('builds a CDN thumb URL from a hash', () => {
		expect(avatarUrl('abc123')).toBe('https://sleepercdn.com/avatars/thumbs/abc123');
	});
});

describe('combineFpts', () => {
	it('combines whole and decimal point fields', () => {
		expect(combineFpts(120, 45)).toBe(120.45);
		expect(combineFpts(0, 5)).toBe(0.05);
	});

	it('defaults missing values to zero', () => {
		expect(combineFpts()).toBe(0);
		expect(combineFpts(100)).toBe(100);
	});
});

describe('buildRosterInfoMap', () => {
	const rosters = [
		{ roster_id: 1, owner_id: 'u1' },
		{ roster_id: 2, owner_id: 'u2' },
		{ roster_id: 3, owner_id: 'u3' },
	] as SleeperRoster[];

	const users = [
		{ user_id: 'u1', display_name: 'Alice', avatar: 'av1', metadata: { team_name: 'Team Alpha' } },
		{ user_id: 'u2', display_name: 'Bob', avatar: null, metadata: {} },
		// u3 intentionally absent from users
	] as unknown as SleeperLeagueUser[];

	it('prefers metadata.team_name, then display_name, then a fallback', () => {
		const map = buildRosterInfoMap(rosters, users);
		expect(map.get(1)?.teamName).toBe('Team Alpha');
		expect(map.get(2)?.teamName).toBe('Bob');
		expect(map.get(3)?.teamName).toBe('Team 3');
	});

	it('exposes ownerName and ownerId', () => {
		const map = buildRosterInfoMap(rosters, users);
		expect(map.get(1)?.ownerName).toBe('Alice');
		expect(map.get(1)?.ownerId).toBe('u1');
		expect(map.get(3)?.ownerName).toBeNull();
	});

	it('applies display-name overrides when present', () => {
		const overrides = new Map([['u1', 'Custom Name']]);
		const map = buildRosterInfoMap(rosters, users, overrides);
		expect(map.get(1)?.teamName).toBe('Custom Name');
		// override does not affect ownerName
		expect(map.get(1)?.ownerName).toBe('Alice');
	});
});
