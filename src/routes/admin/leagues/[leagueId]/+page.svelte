<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const ALL_NAV = [
		{ href: 'standings',      label: 'Standings'      },
		{ href: 'matchups',       label: 'Matchups'       },
		{ href: 'power-rankings', label: 'Power Rankings' },
		{ href: 'rosters',        label: 'Rosters'        },
		{ href: 'records',        label: 'Records'        },
		{ href: 'transactions',   label: 'Transactions'   },
		{ href: 'drafts',         label: 'Drafts'         },
		{ href: 'awards',         label: 'Awards'         },
		{ href: 'managers',       label: 'Managers'       },
		{ href: 'rivalry',        label: 'Rivalry'        },
		{ href: 'blog',           label: 'Blog'           },
	];

	interface NavItem { href: string; label: string; enabled: boolean; }

	function initNavItems(saved: string[]): NavItem[] {
		const enabledSet = new Set(saved);
		const ordered = saved
			.map(h => ALL_NAV.find(n => n.href === h))
			.filter((n): n is typeof ALL_NAV[0] => !!n)
			.map(n => ({ ...n, enabled: true }));
		const rest = ALL_NAV
			.filter(n => !enabledSet.has(n.href))
			.map(n => ({ ...n, enabled: false }));
		return [...ordered, ...rest];
	}

	let navItems = $state<NavItem[]>(initNavItems(data.leagueConfig.enabledNavItems ?? []));

	function moveUp(i: number) {
		if (i === 0) return;
		const arr = [...navItems];
		[arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
		navItems = arr;
	}

	function moveDown(i: number) {
		if (i === navItems.length - 1) return;
		const arr = [...navItems];
		[arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
		navItems = arr;
	}

	const enabledNavValue = $derived(
		navItems.filter(n => n.enabled).map(n => n.href).join(',')
	);

	let confirmDelete = $state(false);
</script>

<div class="max-w-2xl space-y-8">
	<div>
		<nav class="text-xs text-slate-500 mb-4">
			<a href="/admin" class="hover:text-slate-300">Dashboard</a>
			<span class="mx-1.5">›</span>
			<span class="text-slate-300">League Config</span>
		</nav>
		<h1 class="text-2xl font-extrabold text-white">League Config</h1>
		<p class="font-mono text-sm text-slate-500 mt-0.5">{data.leagueId}</p>
	</div>

	<form method="POST" action="?/save" use:enhance class="space-y-6">
		<!-- Contentful / Blog -->
		<div class="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
			<h2 class="text-sm font-semibold text-white">Blog (Contentful)</h2>

			<div>
				<label for="contentfulSpaceId" class="block text-xs font-medium text-slate-400 mb-1">Space ID</label>
				<input
					id="contentfulSpaceId"
					name="contentfulSpaceId"
					type="text"
					value={data.leagueConfig.contentfulSpaceId ?? ''}
					placeholder="xxxxxxxxxxxxxxxxx"
					class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
				/>
			</div>

			<div>
				<label for="contentfulAccessToken" class="block text-xs font-medium text-slate-400 mb-1">Content Delivery Token</label>
				<input
					id="contentfulAccessToken"
					name="contentfulAccessToken"
					type="text"
					value={data.leagueConfig.contentfulAccessToken ?? ''}
					placeholder="Content Delivery API access token"
					class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
				/>
			</div>

			<div>
				<label for="contentfulManagementToken" class="block text-xs font-medium text-slate-400 mb-1">
					Management Token <span class="text-slate-600 font-normal">(optional — for comments)</span>
				</label>
				<input
					id="contentfulManagementToken"
					name="contentfulManagementToken"
					type="text"
					value={data.leagueConfig.contentfulManagementToken ?? ''}
					placeholder="Content Management API token"
					class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
				/>
			</div>
		</div>

		<!-- Nav items -->
		<div class="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
			<div>
				<h2 class="text-sm font-semibold text-white">Navigation</h2>
				<p class="text-xs text-slate-500 mt-0.5">
					Toggle items on/off and drag the order. Disabled items are hidden from the nav.
					Leave all enabled to show the default set.
				</p>
			</div>

			<input type="hidden" name="enabledNavItems" value={enabledNavValue} />

			<div class="space-y-1">
				{#each navItems as item, i}
					<div class="flex items-center gap-3 rounded-lg px-3 py-2
					            {item.enabled ? 'bg-slate-800' : 'bg-slate-900/50'}
					            transition-colors">
						<input
							type="checkbox"
							id="nav-{item.href}"
							bind:checked={navItems[i].enabled}
							class="w-4 h-4 rounded accent-blue-500 cursor-pointer"
						/>
						<label for="nav-{item.href}" class="flex-1 text-sm cursor-pointer
						       {item.enabled ? 'text-white' : 'text-slate-600'}">
							{item.label}
						</label>
						<div class="flex gap-0.5">
							<button
								type="button"
								onclick={() => moveUp(i)}
								disabled={i === 0}
								class="p-1 rounded text-slate-600 hover:text-slate-300 disabled:opacity-20 transition-colors"
								title="Move up"
							>▲</button>
							<button
								type="button"
								onclick={() => moveDown(i)}
								disabled={i === navItems.length - 1}
								class="p-1 rounded text-slate-600 hover:text-slate-300 disabled:opacity-20 transition-colors"
								title="Move down"
							>▼</button>
						</div>
					</div>
				{/each}
			</div>
		</div>

		<div class="flex items-center gap-4">
			<button
				type="submit"
				class="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-medium text-white transition-colors"
			>
				Save Config
			</button>
			{#if form?.success}
				<span class="text-xs text-emerald-400">Saved.</span>
			{/if}
		</div>
	</form>

	<!-- Danger zone -->
	<div class="border border-red-900/50 rounded-xl p-6 space-y-3">
		<h2 class="text-sm font-semibold text-red-400">Danger Zone</h2>
		<p class="text-xs text-slate-500">
			Deletes this league's config document from Firestore. The league itself is unaffected.
		</p>
		{#if confirmDelete}
			<form method="POST" action="?/delete" use:enhance class="flex items-center gap-3">
				<span class="text-xs text-red-400">Are you sure?</span>
				<button
					type="submit"
					class="px-4 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 text-xs font-medium text-white transition-colors"
				>
					Yes, delete
				</button>
				<button
					type="button"
					onclick={() => (confirmDelete = false)}
					class="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 transition-colors"
				>
					Cancel
				</button>
			</form>
		{:else}
			<button
				onclick={() => (confirmDelete = true)}
				class="px-4 py-1.5 rounded-lg border border-red-900 hover:bg-red-950/50 text-xs text-red-400 transition-colors"
			>
				Delete league config
			</button>
		{/if}
	</div>
</div>
