import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	test: {
		projects: [
			{
				extends: true,
				test: {
					name: 'server',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['**/node_modules/**', 'src/**/*.svelte.{test,spec}.{js,ts}'],
					environment: 'node',
				},
			},
			{
				// Component tests. jsdom matters for more than the DOM APIs: under
				// `node` the Svelte plugin compiles server-side, where $effect is a
				// no-op — so hydration-time bugs are invisible there.
				extends: true,
				// Without browser conditions `svelte` resolves to its server build and
				// mount() refuses to run.
				resolve: { conditions: ['browser', 'import', 'module', 'default'] },
				test: {
					name: 'client',
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					environment: 'jsdom',
					// Fallback path only: an effect loop that issues no requests slips
					// past stubFetch's call cap and has to wait for Svelte's own guard,
					// which needs ~1000 render passes. Under the 5s default that would
					// surface as a bare "test timed out" instead of the real
					// effect_update_depth_exceeded.
					testTimeout: 30_000,
				},
			},
		],
	},
});
