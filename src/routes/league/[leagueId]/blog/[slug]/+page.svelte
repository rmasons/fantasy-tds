<script lang="ts">
	import type { PageData } from './$types';
	import { onMount } from 'svelte';

	let { data } = $props<{ data: PageData }>();

	interface Post {
		title: string;
		type: string;
		author: string;
		createdAt: string;
		body: any;
	}

	interface Comment {
		id: string;
		author: string;
		comment: string;
		createdAt: string;
	}

	let post = $state<Post | null>(null);
	let postId = $state('');
	let bodyHtml = $state('');
	let loading = $state(true);
	let error = $state('');

	// Contentful asset lookup: populated from response.includes.Asset before rendering
	let assetMap = new Map<string, any>();

	let comments = $state<Comment[]>([]);
	let commentsLoading = $state(false);
	let commentText = $state('');
	let submitting = $state(false);
	let submitError = $state('');
	let submitSuccess = $state(false);

	function renderNode(node: any): string {
		if (!node) return '';
		if (node.nodeType === 'text') {
			let text = (node.value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
			for (const mark of node.marks ?? []) {
				if (mark.type === 'bold') text = `<strong>${text}</strong>`;
				else if (mark.type === 'italic') text = `<em>${text}</em>`;
				else if (mark.type === 'underline') text = `<u>${text}</u>`;
				else if (mark.type === 'code') text = `<code style="background:#1e293b;padding:0.1em 0.35em;border-radius:0.25rem;font-size:0.875em">${text}</code>`;
			}
			return text;
		}
		const children = (node.content ?? []).map(renderNode).join('');
		switch (node.nodeType) {
			case 'document': return children;
			case 'paragraph': return `<p class="mb-4 leading-relaxed">${children}</p>`;
			case 'heading-1': return `<h1 class="text-3xl font-extrabold mt-8 mb-4">${children}</h1>`;
			case 'heading-2': return `<h2 class="text-2xl font-bold mt-7 mb-3">${children}</h2>`;
			case 'heading-3': return `<h3 class="text-xl font-bold mt-6 mb-3">${children}</h3>`;
			case 'heading-4': return `<h4 class="text-lg font-semibold mt-5 mb-2">${children}</h4>`;
			case 'heading-5': return `<h5 class="text-base font-semibold mt-4 mb-2">${children}</h5>`;
			case 'heading-6': return `<h6 class="text-sm font-semibold mt-3 mb-2">${children}</h6>`;
			case 'unordered-list': return `<ul class="list-disc pl-6 mb-4 space-y-1">${children}</ul>`;
			case 'ordered-list': return `<ol class="list-decimal pl-6 mb-4 space-y-1">${children}</ol>`;
			case 'list-item': return `<li style="color:#cbd5e1">${children}</li>`;
			case 'hyperlink': {
				const uri = node.data?.uri ?? '';
				const safeHref = /^https?:\/\//i.test(uri) ? uri : '#';
				return `<a href="${safeHref}" class="text-blue-400 hover:underline" target="_blank" rel="noopener noreferrer">${children}</a>`;
			}
			case 'hr': return `<hr style="margin:1.5rem 0;border-color:#334155" />`;
			case 'blockquote': return `<blockquote style="border-left:4px solid #475569;padding-left:1rem;font-style:italic;color:#94a3b8;margin:1rem 0">${children}</blockquote>`;
			case 'embedded-asset-block':
			case 'embedded-asset-inline': {
				const id = node.data?.target?.sys?.id;
				const asset = id ? assetMap.get(id) : null;
				const f = asset?.fields ?? node.data?.target?.fields;
				const rawUrl: string = f?.file?.url ?? '';
				const url = rawUrl
					? (rawUrl.startsWith('http') ? rawUrl : `https:${rawUrl}`)
					: null;
				if (!url) return '';
				const alt = (f?.title ?? f?.description ?? '').replace(/"/g, '&quot;');
				const img = `<img src="${url.replace(/"/g, '%22')}" alt="${alt}" style="max-width:100%;border-radius:0.5rem;display:block" />`;
				return node.nodeType === 'embedded-asset-inline'
					? img
					: `<figure style="margin:1.5rem 0;text-align:center">${img}</figure>`;
			}
			case 'table': return `<div style="overflow-x:auto;margin:1rem 0"><table style="width:100%;font-size:0.875rem;border-collapse:collapse">${children}</table></div>`;
			case 'table-row': return `<tr style="border-bottom:1px solid #1e293b">${children}</tr>`;
			case 'table-header-cell': return `<th style="padding:0.5rem 0.75rem;text-align:left;color:#94a3b8;font-weight:500">${children}</th>`;
			case 'table-cell': return `<td style="padding:0.5rem 0.75rem;color:#cbd5e1">${children}</td>`;
			default: return children;
		}
	}

	function formatDate(iso: string) {
		return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
	}

	function timeAgo(iso: string) {
		const diff = Date.now() - new Date(iso).getTime();
		const mins = Math.floor(diff / 60000);
		if (mins < 60) return `${Math.max(1, mins)}m ago`;
		const hrs = Math.floor(mins / 60);
		if (hrs < 24) return `${hrs}h ago`;
		const days = Math.floor(hrs / 24);
		if (days < 30) return `${days}d ago`;
		return formatDate(iso);
	}

	async function fetchComments(id: string) {
		commentsLoading = true;
		try {
			const res = await fetch(`/api/blog/comments?leagueId=${encodeURIComponent(data.leagueId)}&postId=${encodeURIComponent(id)}`);
			if (!res.ok) return;
			const json = await res.json();
			comments = (json.items ?? []).map((item: any) => ({
				id: item.sys.id,
				author: item.fields.author ?? 'Anonymous',
				comment: item.fields.comment ?? '',
				createdAt: item.sys.createdAt,
			}));
		} finally {
			commentsLoading = false;
		}
	}

	async function submitComment(e: SubmitEvent) {
		e.preventDefault();
		if (!commentText.trim() || submitting) return;
		submitting = true;
		submitError = '';
		submitSuccess = false;

		try {
			const res = await fetch('/api/blog/comments', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ leagueId: data.leagueId, postId, comment: commentText.trim() }),
			});
			if (!res.ok) {
				const msg = await res.text().catch(() => `HTTP ${res.status}`);
				throw new Error(msg);
			}
			commentText = '';
			submitSuccess = true;
			await fetchComments(postId);
		} catch (e: any) {
			submitError = e.message;
		} finally {
			submitting = false;
		}
	}

	onMount(async () => {
		try {
			const res = await fetch(`/api/blog?leagueId=${encodeURIComponent(data.leagueId)}&slug=${encodeURIComponent(data.slug)}`);
			if (!res.ok) {
				const text = await res.text();
				throw new Error(text || `HTTP ${res.status}`);
			}
			const contentful = await res.json();
			const item = contentful.items?.[0];
			if (!item) throw new Error('Post not found.');

			postId = item.sys.id;

			// Build asset lookup from includes so embedded images/GIFs resolve correctly
			for (const asset of contentful.includes?.Asset ?? []) {
				assetMap.set(asset.sys.id, asset);
			}

			post = {
				title: item.fields.title ?? 'Untitled',
				type: item.fields.type ?? 'Post',
				author: item.fields.author?.fields?.name ?? item.fields.author ?? 'Unknown',
				createdAt: item.sys.createdAt,
				body: item.fields.body,
			};
			bodyHtml = renderNode(item.fields.body);

			// Load comments in parallel (non-blocking — errors are silent)
			fetchComments(item.sys.id);
		} catch (e: any) {
			error = e.message;
		} finally {
			loading = false;
		}
	});
</script>

<div>
	<a href="/league/{data.leagueId}/blog" class="text-slate-500 hover:text-slate-300 text-sm mb-6 inline-flex items-center gap-1 transition-colors">
		← Blog
	</a>

	{#if loading}
		<div class="space-y-3 mt-4">
			<div class="h-8 bg-slate-800 rounded animate-pulse w-2/3"></div>
			<div class="h-4 bg-slate-800 rounded animate-pulse w-1/3"></div>
			{#each Array(5) as _}
				<div class="h-4 bg-slate-800 rounded animate-pulse"></div>
			{/each}
		</div>
	{:else if error}
		<div class="mt-4 bg-slate-900 rounded-xl border border-slate-800 p-6 text-center">
			<p class="text-slate-400 mb-2">Could not load post.</p>
			<p class="text-slate-600 text-sm">{error}</p>
		</div>
	{:else if post}
		<article class="mt-4 max-w-2xl">
			<div class="flex items-center gap-2 mb-3">
				<span class="text-xs px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 font-semibold ring-1 ring-blue-500/25">{post.type}</span>
				<span class="text-xs text-slate-500">{formatDate(post.createdAt)}</span>
				<span class="text-xs text-slate-600 ml-auto">{post.author}</span>
			</div>
			<h1 class="text-3xl font-extrabold text-white mb-6">{post.title}</h1>
			<div class="text-slate-300 prose-headings:text-white">
				{@html bodyHtml}
			</div>
		</article>

		<!-- Comments -->
		<section class="mt-10 max-w-2xl">
			<h2 class="text-lg font-semibold text-slate-300 mb-4">
				Comments
				{#if comments.length > 0}
					<span class="text-slate-600 font-normal text-base">({comments.length})</span>
				{/if}
			</h2>

			{#if commentsLoading && comments.length === 0}
				<div class="space-y-3">
					{#each Array(2) as _}
						<div class="h-16 bg-slate-800 rounded-xl animate-pulse"></div>
					{/each}
				</div>
			{:else if comments.length > 0}
				<div class="space-y-3 mb-6">
					{#each comments as c}
						<div class="bg-slate-900 rounded-xl border border-slate-800/60 px-4 py-3">
							<div class="flex items-center gap-2 mb-1.5">
								<span class="text-sm font-semibold text-white">{c.author}</span>
								<span class="text-xs text-slate-600">{timeAgo(c.createdAt)}</span>
							</div>
							<p class="text-sm text-slate-300 whitespace-pre-wrap">{c.comment}</p>
						</div>
					{/each}
				</div>
			{:else if !commentsLoading}
				<p class="text-sm text-slate-600 mb-6">No comments yet. Be the first!</p>
			{/if}

			{#if data.user}
				<form onsubmit={submitComment} class="bg-slate-900 rounded-xl border border-slate-800/60 p-4">
					<p class="text-xs text-slate-500 mb-3">
						Commenting as <span class="text-slate-300 font-medium">{data.user.sleeperUsername ?? data.user.email}</span>
					</p>
					<textarea
						bind:value={commentText}
						placeholder="Write a comment…"
						rows="3"
						maxlength="1000"
						class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200
						       placeholder:text-slate-600 resize-none focus:outline-none focus:border-blue-500 transition-colors"
					></textarea>
					{#if submitError}
						<p class="text-xs text-red-400 mt-1">{submitError}</p>
					{/if}
					{#if submitSuccess}
						<p class="text-xs text-green-400 mt-1">Comment posted!</p>
					{/if}
					<div class="flex justify-end mt-2">
						<button
							type="submit"
							disabled={submitting || !commentText.trim()}
							class="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed
							       text-white text-sm font-semibold rounded-lg transition-colors"
						>
							{submitting ? 'Posting…' : 'Post comment'}
						</button>
					</div>
				</form>
			{:else}
				<p class="text-sm text-slate-500 bg-slate-900 rounded-xl border border-slate-800/60 px-4 py-3">
					<a href="/login" class="text-blue-400 hover:underline">Sign in</a> to leave a comment.
				</p>
			{/if}
		</section>
	{/if}
</div>
