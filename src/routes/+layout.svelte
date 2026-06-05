<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import type { LayoutData } from './$types';
	import { onMount } from 'svelte';

	let { data, children } = $props<{ data: LayoutData; children: any }>();

	// Silent session refresh: the server session cookie lasts 1 day. While the
	// Firebase client stays signed in (refresh token), re-mint the cookie so an
	// active user is never abruptly logged out. onIdTokenChanged fires on load
	// and ~hourly token rotation; we throttle the server round-trip to 15 min.
	onMount(() => {
		let lastRefresh = 0;
		let unsub: (() => void) | undefined;

		(async () => {
			const { auth } = await import('$lib/firebase/client');
			const { onIdTokenChanged, getIdToken } = await import('firebase/auth');
			unsub = onIdTokenChanged(auth, async (user) => {
				if (!user) return;
				if (Date.now() - lastRefresh < 15 * 60_000) return;
				lastRefresh = Date.now();
				try {
					const idToken = await getIdToken(user);
					await fetch('/api/auth/session', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ idToken })
					});
				} catch {
					lastRefresh = 0; // allow a retry on the next token change
				}
			});
		})();

		return () => unsub?.();
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800;900&family=Inter:ital,opsz,wght@0,14..32,400;0,14..32,500;0,14..32,600;0,14..32,700;0,14..32,800;0,14..32,900;1,14..32,400&display=swap" rel="stylesheet" />
</svelte:head>

{@render children()}
