import { error } from '@sveltejs/kit';

const ID_PATTERN = /^[\w-]+$/;

/** Validate a Sleeper-style identifier (alphanumeric, underscore, hyphen). */
export function validateId(id: string | null | undefined, name = 'id'): string {
	if (!id) throw error(400, `Missing ${name}`);
	if (!ID_PATTERN.test(id)) throw error(400, `Invalid ${name}`);
	return id;
}

/** Validate a leagueId. Throws a 400 if missing or malformed. */
export function validateLeagueId(id: string | null | undefined): string {
	return validateId(id, 'leagueId');
}
