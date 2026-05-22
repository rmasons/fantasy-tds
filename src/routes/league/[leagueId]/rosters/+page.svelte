<script lang="ts">
	import type { LayoutData } from '../$types';
	import type { SleeperRoster, SleeperLeagueUser } from '$lib/types';
	import type { SlimPlayer } from '$lib/types';
	import { onMount } from 'svelte';

	let { data } = $props<{ data: LayoutData }>();

	interface RosterTeam {
		rosterId: number;
		teamName: string;
		ownerName: string;
		avatar: string | null;
		starters: { id: string; name: string; pos: string; team: string }[];
		bench: { id: string; name: string; pos: string; team: string }[];
		ir: { id: string; name: string; pos: string; team: string }[];
		starterSlots: string[];
	}

	let teams = $state<RosterTeam[]>([]);
	let loading = $state(true);
	let error = $state('');
	let expandedId = $state<number | null>(null);

	function playerInfo(id: string, players: Record<string, SlimPlayer>) {
		const p = players[id];
		return p ? { id, name: p.name, pos: p.pos, team: p.team } : { id, name: id, pos: '?', team: 'FA' };
	}

	const posOrder = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'K', 'DEF', 'IDP_FLEX', 'BN', 'IR'];

	onMount(async () => {
		try {
			const [rostersRes, usersRes, leagueRes, playersRes] = await Promise.all([
				fetch(`https://api.sleeper.app/v1/league/${data.leagueId}/rosters`),
				fetch(`https://api.sleeper.app/v1/league/${data.leagueId}/users`),
				fetch(`https://api.sleeper.app/v1/league/${data.leagueId}`),
				fetch('/api/players')
			]);
			const [rosters, users, league, players]: [SleeperRoster[], SleeperLeagueUser[], any, Record<string, SlimPlayer>] =
				await Promise.all([rostersRes.json(), usersRes.json(), leagueRes.json(), playersRes.json()]);

			const starterSlots: string[] = league.roster_positions ?? [];
			const userMap = new Map<string, SleeperLeagueUser>(users.map((u) => [u.user_id, u]));

			teams = rosters.map((r) => {
				const u = userMap.get(r.owner_id);
				const avatarHash = u?.metadata?.avatar ?? u?.avatar;
				const starterIds = new Set((r as any).starters ?? []);
				const irIds = new Set((r as any).reserve ?? []);
				const allIds: string[] = (r as any).players ?? [];

				return {
					rosterId: r.roster_id,
					teamName: u?.metadata?.team_name ?? u?.display_name ?? 'Unknown',
					ownerName: u?.display_name ?? '',
					avatar: avatarHash ? `https://sleepercdn.com/avatars/thumbs/${avatarHash}` : null,
					starterSlots,
					starters: [...starterIds].map((id) => playerInfo(id as string, players)),
					bench: allIds
						.filter((id) => !starterIds.has(id) && !irIds.has(id))
						.map((id) => playerInfo(id, players)),
					ir: [...irIds].map((id) => playerInfo(id as string, players))
				};
			});

			teams.sort((a, b) => a.teamName.localeCompare(b.teamName));
		} catch (e: any) {
			error = e.message;
		} finally {
			loading = false;
		}
	});

	const posColor: Record<string, string> = {
		QB: 'bg-red-900/60 text-red-300',
		RB: 'bg-green-900/60 text-green-300',
		WR: 'bg-blue-900/60 text-blue-300',
		TE: 'bg-yellow-900/60 text-yellow-300',
		K: 'bg-purple-900/60 text-purple-300',
		DEF: 'bg-orange-900/60 text-orange-300'
	};
	function pc(pos: string) { return posColor[pos] ?? 'bg-gray-700 text-gray-300'; }
</script>

<div>
	<h1 class="text-2xl font-bold mb-6">Rosters</h1>

	{#if loading}
		<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
			{#each Array(12) as _}
				<div class="h-24 bg-gray-800 rounded-xl animate-pulse"></div>
			{/each}
		</div>
	{:else if error}
		<p class="text-red-400">Failed to load rosters: {error}</p>
	{:else}
		<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
			{#each teams as team (team.rosterId)}
				<div class="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
					<!-- Team header -->
					<button
						onclick={() => expandedId = expandedId === team.rosterId ? null : team.rosterId}
						class="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-800/60 transition-colors text-left"
					>
						{#if team.avatar}
							<img src={team.avatar} alt="" class="w-10 h-10 rounded-full object-cover shrink-0" />
						{:else}
							<div class="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center shrink-0">🏈</div>
						{/if}
						<div class="flex-1 min-w-0">
							<p class="font-medium text-white text-sm truncate">{team.teamName}</p>
							{#if team.ownerName !== team.teamName}
								<p class="text-xs text-gray-500">{team.ownerName}</p>
							{/if}
						</div>
						<div class="text-gray-500 text-sm">{team.starters.length + team.bench.length}</div>
						<span class="text-gray-500 text-xs ml-1">{expandedId === team.rosterId ? '▲' : '▼'}</span>
					</button>

					{#if expandedId === team.rosterId}
						<div class="border-t border-gray-800 px-4 py-3 space-y-4">
							<!-- Starters -->
							{#if team.starters.length}
								<div>
									<p class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Starters</p>
									<div class="space-y-1">
										{#each team.starters as p, i}
											<div class="flex items-center gap-2 text-sm">
												<span class="text-xs text-gray-600 w-4 text-right">{i + 1}</span>
												<span class="text-xs px-1.5 py-0.5 rounded font-bold {pc(p.pos)}">{p.pos}</span>
												<span class="text-gray-200 truncate flex-1">{p.name}</span>
												<span class="text-xs text-gray-500 shrink-0">{p.team}</span>
											</div>
										{/each}
									</div>
								</div>
							{/if}

							<!-- Bench -->
							{#if team.bench.length}
								<div>
									<p class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Bench</p>
									<div class="space-y-1">
										{#each team.bench as p}
											<div class="flex items-center gap-2 text-sm">
												<span class="text-xs px-1.5 py-0.5 rounded font-bold {pc(p.pos)}">{p.pos}</span>
												<span class="text-gray-400 truncate flex-1">{p.name}</span>
												<span class="text-xs text-gray-600 shrink-0">{p.team}</span>
											</div>
										{/each}
									</div>
								</div>
							{/if}

							<!-- IR -->
							{#if team.ir.length}
								<div>
									<p class="text-xs font-semibold text-red-500/70 uppercase tracking-wider mb-2">IR</p>
									<div class="space-y-1">
										{#each team.ir as p}
											<div class="flex items-center gap-2 text-sm">
												<span class="text-xs px-1.5 py-0.5 rounded font-bold bg-red-900/50 text-red-400">{p.pos}</span>
												<span class="text-gray-400 truncate flex-1">{p.name}</span>
												<span class="text-xs text-gray-600 shrink-0">{p.team}</span>
											</div>
										{/each}
									</div>
								</div>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
