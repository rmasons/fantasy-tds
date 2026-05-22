<script lang="ts">
	import type { PageData } from './$types';
	import { onMount } from 'svelte';

	let { data } = $props<{ data: PageData }>();

	interface BlogPost {
		id: string;
		slug: string;
		title: string;
		type: string;
		author: string;
		createdAt: string;
		excerpt: string;
	}

	let posts = $state<BlogPost[]>([]);
	let loading = $state(true);
	let error = $state('');
	let filterType = $state('');
	let categories = $state<string[]>([]);

	function excerpt(body: any): string {
		const first = body?.content?.find((n: any) => n.nodeType === 'paragraph');
		const text = first?.content?.map((n: any) => n.value ?? '').join('') ?? '';
		return text.length > 200 ? text.slice(0, 200) + '…' : text;
	}

	function formatDate(iso: string) {
		return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
	}

	onMount(async () => {
		try {
			const res = await fetch('/api/blog');
			if (!res.ok) {
				const text = await res.text();
				throw new Error(text || `HTTP ${res.status}`);
			}
			const contentful = await res.json();

			const rawPosts = contentful.items ?? [];
			posts = rawPosts.map((item: any) => ({
				id: item.sys.id,
				slug: item.fields.slug ?? item.sys.id,
				title: item.fields.title ?? 'Untitled',
				type: item.fields.type ?? 'Post',
				author: item.fields.author?.fields?.name ?? item.fields.author ?? 'Unknown',
				createdAt: item.sys.createdAt,
				excerpt: excerpt(item.fields.body),
			}));

			const catSet = new Set<string>(posts.map(p => p.type));
			categories = [...catSet];
		} catch (e: any) {
			error = e.message;
		} finally {
			loading = false;
		}
	});

	const filtered = $derived(filterType ? posts.filter(p => p.type === filterType) : posts);
</script>

<div>
	<div class="flex items-center justify-between mb-6 flex-wrap gap-3">
		<h1 class="text-2xl font-bold">Blog</h1>

		{#if categories.length > 0}
			<div class="flex gap-1 flex-wrap">
				<button
					onclick={() => (filterType = '')}
					class="px-3 py-1 rounded-full text-xs font-medium transition-colors
					       {filterType === '' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}"
				>All</button>
				{#each categories as cat}
					<button
						onclick={() => (filterType = cat)}
						class="px-3 py-1 rounded-full text-xs font-medium transition-colors
						       {filterType === cat ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}"
					>{cat}</button>
				{/each}
			</div>
		{/if}
	</div>

	{#if loading}
		<div class="space-y-4">
			{#each Array(4) as _}
				<div class="h-28 bg-gray-800 rounded-xl animate-pulse"></div>
			{/each}
		</div>
	{:else if error}
		<div class="bg-gray-900 rounded-xl border border-gray-800 p-6 text-center">
			<p class="text-gray-400 mb-2">Could not load blog posts.</p>
			<p class="text-gray-600 text-sm">{error}</p>
		</div>
	{:else if filtered.length === 0}
		<p class="text-gray-400">No posts found.</p>
	{:else}
		<div class="space-y-4">
			{#each filtered as post}
				<a
					href="/league/{data.leagueId}/blog/{post.slug}"
					class="block bg-gray-900 rounded-xl border border-gray-800 hover:border-gray-700 transition-colors p-5"
				>
					<div class="flex items-center gap-2 mb-2">
						<span class="text-xs px-2 py-0.5 rounded-full bg-blue-900/60 text-blue-300 font-medium">{post.type}</span>
						<span class="text-xs text-gray-500">{formatDate(post.createdAt)}</span>
						<span class="text-xs text-gray-600 ml-auto">{post.author}</span>
					</div>
					<h2 class="text-base font-semibold text-white mb-1">{post.title}</h2>
					{#if post.excerpt}
						<p class="text-sm text-gray-400 line-clamp-2">{post.excerpt}</p>
					{/if}
				</a>
			{/each}
		</div>
	{/if}
</div>
