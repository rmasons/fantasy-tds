import type { PageServerLoad } from './$types';
import { getLeagueConfig } from '$lib/server/config';

function findFirstImage(node: any, assets: Map<string, any>): string | null {
	if (!node) return null;
	if (node.nodeType === 'embedded-asset-block' || node.nodeType === 'embedded-asset-inline') {
		const id = node.data?.target?.sys?.id;
		const asset = id ? assets.get(id) : null;
		const f = asset?.fields ?? node.data?.target?.fields;
		const rawUrl: string = f?.file?.url ?? '';
		const contentType: string = f?.file?.contentType ?? '';
		if (rawUrl && contentType.startsWith('image/')) {
			return rawUrl.startsWith('http') ? rawUrl : `https:${rawUrl}`;
		}
	}
	for (const child of node.content ?? []) {
		const found = findFirstImage(child, assets);
		if (found) return found;
	}
	return null;
}

function getTextExcerpt(node: any, maxLen = 160): string {
	if (!node) return '';
	if (node.nodeType === 'text') return node.value ?? '';
	return (node.content ?? []).map((c: any) => getTextExcerpt(c)).join('').slice(0, maxLen);
}

export const load: PageServerLoad = async ({ params, parent }) => {
	const { leagueId, slug } = params;
	const { leagueAvatar } = await parent();
	const config = await getLeagueConfig(leagueId);
	const spaceId = config.contentfulSpaceId ?? '';
	const token = config.contentfulAccessToken ?? '';

	if (!spaceId || !token) return { slug };

	const baseParams = new URLSearchParams({
		content_type: 'blog_post',
		include: '2',
		access_token: token,
	});

	let data: any = null;

	const idRes = await fetch(`https://cdn.contentful.com/spaces/${spaceId}/entries?${baseParams}&sys.id=${encodeURIComponent(slug)}`);
	if (idRes.ok) {
		const d = await idRes.json();
		if (d.items?.length > 0) data = d;
	}

	if (!data) {
		const slugParams = new URLSearchParams({ ...Object.fromEntries(baseParams), 'fields.slug': slug, limit: '1' });
		const slugRes = await fetch(`https://cdn.contentful.com/spaces/${spaceId}/entries?${slugParams}`);
		if (slugRes.ok) data = await slugRes.json();
	}

	if (!data?.items?.[0]) return { slug };

	const item = data.items[0];
	const assetMap = new Map<string, any>();
	for (const asset of data.includes?.Asset ?? []) {
		assetMap.set(asset.sys.id, asset);
	}

	const ogTitle: string = item.fields.title ?? '';
	const ogImage = findFirstImage(item.fields.body, assetMap) ?? leagueAvatar;
	const ogDescription = getTextExcerpt(item.fields.body).trim();

	// Check if this is the most recent post so we can show a hidden egg
	const latestParams = new URLSearchParams({ ...Object.fromEntries(baseParams), order: '-sys.createdAt', limit: '1', select: 'sys.id' });
	const latestRes = await fetch(`https://cdn.contentful.com/spaces/${spaceId}/entries?${latestParams}`);
	const latestData = latestRes.ok ? await latestRes.json() : null;
	const isLatestPost = latestData?.items?.[0]?.sys?.id === item.sys.id;

	return { slug, ogTitle, ogImage, ogDescription, isLatestPost };
};
