import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	return {
		userId: params.userId,
		isAdmin: !!(locals.user?.isAdmin),
	};
};
