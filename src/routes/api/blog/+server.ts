import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

export const GET: RequestHandler = async ({ url }) => {
	const spaceId = env.CONTENTFUL_SPACE_ID ?? '';
	const token = env.CONTENTFUL_ACCESS_TOKEN ?? '';
	const slug = url.searchParams.get('slug');

	if (!spaceId || !token) {
		throw error(503, 'Blog is not configured. Add CONTENTFUL_SPACE_ID and CONTENTFUL_ACCESS_TOKEN to your environment.');
	}

	const baseParams = {
		content_type: 'blog_post',
		include: '2',
		access_token: token,
	};

	// Fetch the full list (no slug filter)
	if (!slug) {
		const params = new URLSearchParams({ ...baseParams, order: '-sys.createdAt' });
		const res = await fetch(`https://cdn.contentful.com/spaces/${spaceId}/entries?${params}`);
		if (!res.ok) throw error(502, 'Failed to fetch blog posts from Contentful.');
		return json(await res.json());
	}

	// Single-post lookup: try sys.id first (always valid), then fields.slug (only works if the
	// content type has a slug field and the URL value is a real slug rather than an entry ID)
	const idParams = new URLSearchParams({ ...baseParams, 'sys.id': slug });
	const idRes = await fetch(`https://cdn.contentful.com/spaces/${spaceId}/entries?${idParams}`);
	if (idRes.ok) {
		const idData = await idRes.json();
		if ((idData.items?.length ?? 0) > 0) return json(idData);
	}

	const slugParams = new URLSearchParams({ ...baseParams, 'fields.slug': slug, limit: '1' });
	const slugRes = await fetch(`https://cdn.contentful.com/spaces/${spaceId}/entries?${slugParams}`);
	if (slugRes.ok) return json(await slugRes.json());

	return json({ items: [] });
};
