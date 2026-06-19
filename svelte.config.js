import adapter from '@sveltejs/adapter-vercel';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		// Explicit Vercel adapter so we can pin the runtime and a single region.
		// One region (iad1, US East) keeps all serverless functions co-located —
		// fewer cold starts and no cross-region egress for a US-based league app.
		// Change `regions` if your members are concentrated elsewhere.
		adapter: adapter({
			runtime: 'nodejs22.x',
			regions: ['iad1']
		})
	}
};

export default config;
