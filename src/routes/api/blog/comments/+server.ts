import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminDb } from '$lib/firebase/admin';
import { getLeagueConfig } from '$lib/server/config';
import { checkRateLimit } from '$lib/server/rateLimit';
import { validateLeagueId } from '$lib/server/leagueId';

const COMMENT_RATE_LIMIT_MS = 30_000;

// GET /api/blog/comments?leagueId=<id>&postId=<contentful-entry-id>
export const GET: RequestHandler = async ({ url, getClientAddress }) => {
	if (!(await checkRateLimit(`comments:${getClientAddress()}`))) {
		return new Response('Too many requests.', { status: 429, headers: { 'Retry-After': '60' } });
	}
	const leagueId = validateLeagueId(url.searchParams.get('leagueId'));
	const postId = url.searchParams.get('postId');

	if (!postId) throw error(400, 'Missing postId');

	const config = await getLeagueConfig(leagueId);
	const spaceId = config.contentfulSpaceId ?? '';
	const deliveryToken = config.contentfulAccessToken ?? '';

	if (!spaceId || !deliveryToken) throw error(503, 'Blog is not configured for this league.');

	const params = new URLSearchParams({
		content_type: 'blog_comment',
		'fields.blogID': postId,
		order: 'sys.createdAt',
		access_token: deliveryToken,
	});

	const res = await fetch(`https://cdn.contentful.com/spaces/${spaceId}/entries?${params}`);
	if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) {
		throw error(502, 'Failed to fetch comments.');
	}

	const data = await res.json();
	return json(data);
};

// POST /api/blog/comments  body: { leagueId, postId, comment }
export const POST: RequestHandler = async ({ request, locals, getClientAddress }) => {
	if (!(await checkRateLimit(`comments-post:${getClientAddress()}`, 10))) {
		return new Response('Too many requests.', { status: 429, headers: { 'Retry-After': '60' } });
	}
	if (!locals.user) throw error(401, 'You must be signed in to comment.');

	const body = await request.json().catch(() => null);
	if (!body?.leagueId || !body?.postId || !body?.comment?.trim()) {
		throw error(400, 'leagueId, postId, and comment are required.');
	}
	const leagueId = validateLeagueId(body.leagueId);

	const config = await getLeagueConfig(leagueId);
	const spaceId = config.contentfulSpaceId ?? '';
	const mgmtToken = config.contentfulManagementToken ?? '';

	if (!spaceId || !mgmtToken) {
		throw error(503, 'Comments are not configured for this league.');
	}

	// Rate limit: one comment per 30 seconds per user
	const userRef = adminDb().collection('users').doc(locals.user.uid);
	const userSnap = await userRef.get();
	const lastAt: number = userSnap.data()?.lastCommentAt ?? 0;
	if (Date.now() - lastAt < COMMENT_RATE_LIMIT_MS) {
		throw error(429, 'Please wait before posting another comment.');
	}

	const author = locals.user.sleeperUsername ?? locals.user.email ?? 'Anonymous';
	const comment = String(body.comment).trim().slice(0, 1000);

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
		console.error('[comments] Contentful create failed:', createRes.status, createRes.statusText);
		throw error(502, 'Failed to save comment.');
	}

	await userRef.update({ lastCommentAt: Date.now() });

	return json({ ok: true, published: false });
};
