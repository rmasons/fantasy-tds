import type { UserProfile } from '$lib/types';

declare global {
	namespace App {
		interface Locals {
			user: UserProfile | null;
		}
		interface PageData {
			user: UserProfile | null;
		}
	}
}

export {};
