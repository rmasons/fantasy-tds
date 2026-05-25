<script lang="ts">
	import type { PageData } from './$types';
	import { onMount } from 'svelte';
	import FaabEasterEgg from '$lib/components/FaabEasterEgg.svelte';

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
			const res = await fetch(`/api/blog?leagueId=${encodeURIComponent(data.leagueId)}`);
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
	<div class="mb-6">
		<h1 class="font-sport font-black text-5xl uppercase tracking-tight text-white leading-none">Blog</h1>
	</div>

	{#if categories.length > 0}
		<div class="flex mb-6 border-b border-navy-700 flex-wrap">
			<button
				onclick={() => (filterType = '')}
				class="px-5 py-2.5 font-sport font-bold uppercase text-sm tracking-wider -mb-px transition-colors
				       {filterType === '' ? 'text-amber-400 border-b-2 border-amber-400' : 'text-navy-500 hover:text-slate-300'}"
			>All<FaabEasterEgg eggId="11" leagueId={data.leagueId} loggedIn={!!data.user} /></button>
			{#each categories as cat}
				<button
					onclick={() => (filterType = cat)}
					class="px-5 py-2.5 font-sport font-bold uppercase text-sm tracking-wider -mb-px transition-colors
					       {filterType === cat ? 'text-amber-400 border-b-2 border-amber-400' : 'text-navy-500 hover:text-slate-300'}"
				>{cat}</button>
			{/each}
		</div>
	{/if}

	{#if loading}
		<div class="space-y-4">
			{#each Array(4) as _}
				<div class="h-28 bg-navy-850 rounded-lg animate-pulse"></div>
			{/each}
		</div>
	{:else if error}
		<div class="bg-navy-850 rounded-lg border border-navy-700 p-6 text-center">
			<p class="text-navy-500 mb-2">Could not load blog posts.</p>
			<p class="text-navy-500 text-sm">{error}</p>
		</div>
	{:else if filtered.length === 0}
		<p class="text-navy-500">No posts found.</p>
	{:else}
		<div class="space-y-3">
			{#each filtered as post}
				<a
					href="/league/{data.leagueId}/blog/{post.slug}"
					class="block bg-navy-850 rounded-lg border border-navy-700 hover:border-navy-600
					       hover:bg-navy-800 transition-all p-5 group"
				>
					<div class="flex items-center gap-2 mb-2">
						<span class="text-xs px-2 py-0.5 rounded font-semibold bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/25">{post.type}</span>
						<span class="text-xs text-navy-500">{formatDate(post.createdAt)}</span>
						<span class="text-xs text-navy-500 ml-auto">{post.author}</span>
					</div>
					<h2 class="text-base font-semibold text-white mb-1 group-hover:text-amber-300 transition-colors">{post.title}</h2>
					{#if post.excerpt}
						<p class="text-sm text-navy-500 line-clamp-2 leading-relaxed">{post.excerpt}</p>
					{/if}
				</a>
			{/each}
		</div>
	{/if}
</div>
