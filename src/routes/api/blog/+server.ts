import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getLeagueConfig } from '$lib/server/config';
import { checkRateLimit } from '$lib/server/rateLimit';

export const GET: RequestHandler = async ({ url, getClientAddress }) => {
	if (!checkRateLimit(`blog:${getClientAddress()}`)) {
		return new Response('Too many requests.', { status: 429, headers: { 'Retry-After': '60' } });
	}
	const leagueId = url.searchParams.get('leagueId') ?? '';
	if (!leagueId) throw error(400, 'Missing leagueId');
	if (!/^[\w-]+$/.test(leagueId)) throw error(400, 'Invalid leagueId.');

	const config = await getLeagueConfig(leagueId);
	const spaceId = config.contentfulSpaceId ?? '';
	const token = config.contentfulAccessToken ?? '';
	const slug = url.searchParams.get('slug');

	if (!spaceId || !token) {
		throw error(503, 'Blog is not configured for this league.');
	}

	const baseParams = {
		content_type: 'blog_post',
		include: '2',
		access_token: token,
	};

	const isJson = (r: Response) => !!r.headers.get('content-type')?.includes('json');

	if (!slug) {
		const params = new URLSearchParams({ ...baseParams, order: '-sys.createdAt' });
		const res = await fetch(`https://cdn.contentful.com/spaces/${spaceId}/entries?${params}`);
		if (!res.ok || !isJson(res)) throw error(502, 'Failed to fetch blog posts from Contentful.');
		return json(await res.json());
	}

	const idParams = new URLSearchParams({ ...baseParams, 'sys.id': slug });
	const idRes = await fetch(`https://cdn.contentful.com/spaces/${spaceId}/entries?${idParams}`);
	if (idRes.ok && isJson(idRes)) {
		const idData = await idRes.json();
		if ((idData.items?.length ?? 0) > 0) return json(idData);
	}

	const slugParams = new URLSearchParams({ ...baseParams, 'fields.slug': slug, limit: '1' });
	const slugRes = await fetch(`https://cdn.contentful.com/spaces/${spaceId}/entries?${slugParams}`);
	if (slugRes.ok && isJson(slugRes)) return json(await slugRes.json());

	return json({ items: [] });
};
