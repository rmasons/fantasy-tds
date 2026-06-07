import { describe, it, expect } from 'vitest';
import { validateId, validateLeagueId } from './leagueId';

function status(fn: () => void): number | undefined {
	try {
		fn();
	} catch (e) {
		return (e as { status?: number }).status;
	}
	return undefined;
}

describe('validateId', () => {
	it('returns the id when it is well-formed', () => {
		expect(validateId('123456', 'leagueId')).toBe('123456');
		expect(validateId('abc-DEF_9', 'draftId')).toBe('abc-DEF_9');
	});

	it('throws 400 when missing', () => {
		expect(status(() => validateId(null))).toBe(400);
		expect(status(() => validateId(''))).toBe(400);
		expect(status(() => validateId(undefined))).toBe(400);
	});

	it('throws 400 for disallowed characters', () => {
		expect(status(() => validateId('a/b'))).toBe(400);
		expect(status(() => validateId('a b'))).toBe(400);
		expect(status(() => validateId('a.b'))).toBe(400);
		expect(status(() => validateId('a@b'))).toBe(400);
	});
});

describe('validateLeagueId', () => {
	it('accepts a valid leagueId', () => {
		expect(validateLeagueId('1312667531357458432')).toBe('1312667531357458432');
	});

	it('rejects an invalid leagueId', () => {
		expect(status(() => validateLeagueId('bad id!'))).toBe(400);
	});
});
