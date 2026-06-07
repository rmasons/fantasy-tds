import { describe, it, expect } from 'vitest';
import { redactManagerProfile } from './managerProfile';
import type { ManagerProfile } from '$lib/types';

const full: ManagerProfile = {
	sleeperUserId: 'u1',
	displayName: 'Ace',
	firstName: 'Alice',
	lastName: 'Anderson',
	email: 'alice@example.com',
	bio: 'hello',
	location: 'NYC',
	favoriteNFLTeam: 'Chiefs',
	favoritePlayer: 'Mahomes',
	favoritePlayerId: '4046',
	preferredContact: 'text me',
	updatedAt: 123,
};

describe('redactManagerProfile', () => {
	it('strips private fields', () => {
		const pub = redactManagerProfile(full);
		expect(pub.email).toBeUndefined();
		expect(pub.firstName).toBeUndefined();
		expect(pub.lastName).toBeUndefined();
		expect(pub.preferredContact).toBeUndefined();
	});

	it('keeps the public subset', () => {
		const pub = redactManagerProfile(full);
		expect(pub.sleeperUserId).toBe('u1');
		expect(pub.displayName).toBe('Ace');
		expect(pub.bio).toBe('hello');
		expect(pub.location).toBe('NYC');
		expect(pub.favoriteNFLTeam).toBe('Chiefs');
		expect(pub.favoritePlayer).toBe('Mahomes');
		expect(pub.favoritePlayerId).toBe('4046');
	});

	it('does not mutate the input', () => {
		redactManagerProfile(full);
		expect(full.email).toBe('alice@example.com');
		expect(full.firstName).toBe('Alice');
	});
});
