import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

function getConfig() {
	const spaceId = env.CONTENTFUL_SPACE_ID ?? '';
	const deliveryToken = env.CONTENTFUL_ACCESS_TOKEN ?? '';
	const mgmtToken = env.CONTENTFUL_MANAGEMENT_TOKEN ?? '';
	return { spaceId, deliveryToken, mgmtToken };
}

// GET /api/blog/comments?postId=<contentful-entry-id>
export const GET: RequestHandler = async ({ url }) => {
	const { spaceId, deliveryToken } = getConfig();
	const postId = url.searchParams.get('postId');

	if (!spaceId || !deliveryToken) {
		throw error(503, 'Blog is not configured.');
	}
	if (!postId) throw error(400, 'Missing postId');

	const params = new URLSearchParams({
		content_type: 'blog_comment',
		'fields.blogID': postId,
		order: 'sys.createdAt',
		access_token: deliveryToken,
	});

	const res = await fetch(`https://cdn.contentful.com/spaces/${spaceId}/entries?${params}`);
	if (!res.ok) throw error(502, 'Failed to fetch comments.');

	const data = await res.json();
	return json(data);
};

// POST /api/blog/comments  body: { postId, comment }
export const POST: RequestHandler = async ({ request, locals }) => {
	const { spaceId, mgmtToken } = getConfig();

	if (!spaceId || !mgmtToken) {
		throw error(503, 'Comments are not configured. Add CONTENTFUL_MANAGEMENT_TOKEN to your environment.');
	}
	if (!locals.user) throw error(401, 'You must be signed in to comment.');

	const body = await request.json().catch(() => null);
	if (!body?.postId || !body?.comment?.trim()) {
		throw error(400, 'postId and comment are required.');
	}

	const author = locals.user.sleeperUsername ?? locals.user.email ?? 'Anonymous';
	const comment = String(body.comment).trim().slice(0, 1000);

	// Create draft entry via Contentful Management API
	const createRes = await fetch(
		`https://api.contentful.com/spaces/${spaceId}/environments/master/entries`,
		{
			method: 'POST',
			headers: {
				Authorization: `Bearer ${mgmtToken}`,
				'Content-Type': 'application/vnd.contentful.management.v1+json',
				'X-Contentful-Content-Type': 'blog_comment',
			},
			body: JSON.stringify({
				fields: {
					blogID: { 'en-US': body.postId },
					comment: { 'en-US': comment },
					author: { 'en-US': author },
				},
			}),
		}
	);

	if (!createRes.ok) {
		const detail = await createRes.text().catch(() => '');
		throw error(502, `Failed to save comment: ${detail}`);
	}

	const entry = await createRes.json();

	// Publish immediately
	const publishRes = await fetch(
		`https://api.contentful.com/spaces/${spaceId}/environments/master/entries/${entry.sys.id}/published`,
		{
			method: 'PUT',
			headers: {
				Authorization: `Bearer ${mgmtToken}`,
				'X-Contentful-Version': String(entry.sys.version),
			},
		}
	);

	if (!publishRes.ok) {
		// Comment was created but not published — still return success so it goes live after manual review
		return json({ ok: true, published: false });
	}

	return json({ ok: true, published: true });
};
