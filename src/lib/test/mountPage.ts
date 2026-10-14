import { mount, unmount, flushSync } from 'svelte';
import { vi } from 'vitest';

/**
 * Mount a route component the way the browser does and flush the first round of
 * effects. Anything that blows up during hydration — an effect that reads and
 * writes the same state, a template that dereferences missing data — throws out
 * of here instead of silently shipping.
 *
 * Only meaningful under the `client` vitest project: with `environment: 'node'`
 * the Svelte plugin compiles server-side, where $effect never runs. Name component
 * test files `*.svelte.test.ts` so they land in that project.
 */
export function mountPage(Component: unknown, props: Record<string, unknown>): { html: string } {
	const target = document.createElement('div');
	document.body.appendChild(target);
	let component: Record<string, unknown> | null = null;
	try {
		component = mount(Component as never, { target, props });
		flushSync();
		return { html: target.innerHTML };
	} finally {
		if (component) unmount(component);
		target.remove();
	}
}

export interface FetchStub {
	/** Every URL the component requested, in call order. */
	calls: string[];
}

export interface StubFetchOptions {
	/**
	 * Abort the mount once this many requests have been made. Our setup effects
	 * each fire a handful of requests, so an order-of-magnitude overshoot means
	 * the effect is re-running — i.e. it reads and writes the same state.
	 *
	 * This exists because Svelte's own infinite-loop guard only trips after ~1000
	 * passes, and 1000 renders of a large page takes minutes. Failing here turns
	 * that into a fast, legible failure.
	 */
	maxCalls?: number;
}

/**
 * Replace global fetch with a stub whose responses never settle, so a mount test
 * observes only synchronous hydration behaviour — no async state writes racing
 * the assertions. Records the URLs so tests can assert what a page kicks off.
 */
export function stubFetch({ maxCalls = 40 }: StubFetchOptions = {}): FetchStub {
	const calls: string[] = [];
	vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
		calls.push(String(input));
		if (calls.length > maxCalls) {
			throw new Error(
				`fetch called ${calls.length} times during mount (limit ${maxCalls}). ` +
					`A setup effect is almost certainly re-running — check for an effect that ` +
					`reads and writes the same $state. Last URL: ${calls[calls.length - 1]}`
			);
		}
		return new Promise<Response>(() => {});
	});
	return { calls };
}
