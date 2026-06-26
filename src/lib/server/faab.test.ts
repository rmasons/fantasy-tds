import { describe, it, expect } from 'vitest';
import { netFromLedger, resolveLedger, sortLedger } from './faab';
import type { FaabTransaction } from '$lib/server/config';

function txn(over: Partial<FaabTransaction> = {}): FaabTransaction {
	return {
		id: over.id ?? 'id1',
		rosterId: over.rosterId ?? '1',
		amount: over.amount ?? 5,
		reason: over.reason ?? 'reason',
		createdAt: over.createdAt ?? 1000,
		createdBy: over.createdBy ?? 'admin',
	};
}

describe('netFromLedger', () => {
	it('sums adjustments per roster', () => {
		const net = netFromLedger([
			txn({ id: 'a', rosterId: '1', amount: 5 }),
			txn({ id: 'b', rosterId: '1', amount: 3 }),
			txn({ id: 'c', rosterId: '2', amount: -4 }),
		]);
		expect(net).toEqual({ '1': 8, '2': -4 });
	});

	it('drops rosters whose adjustments net to zero', () => {
		const net = netFromLedger([
			txn({ id: 'a', rosterId: '1', amount: 5 }),
			txn({ id: 'b', rosterId: '1', amount: -5 }),
		]);
		expect(net['1']).toBeUndefined();
	});

	it('returns an empty map for no transactions', () => {
		expect(netFromLedger([])).toEqual({});
	});
});

describe('resolveLedger', () => {
	it('returns the transaction list when present', () => {
		const txns = [txn({ id: 'a' })];
		expect(resolveLedger({ faabTransactions: txns })).toEqual(txns);
	});

	it('synthesizes opening-balance entries from legacy faabBonuses', () => {
		const led = resolveLedger({ faabBonuses: { '1': 10, '2': -3 } });
		expect(led).toHaveLength(2);
		const one = led.find((t) => t.rosterId === '1')!;
		expect(one.amount).toBe(10);
		expect(one.reason).toBe('Opening balance');
		// Net of the synthesized ledger matches the legacy bonuses (budgets preserved).
		expect(netFromLedger(led)).toEqual({ '1': 10, '2': -3 });
	});

	it('skips zero legacy bonuses', () => {
		const led = resolveLedger({ faabBonuses: { '1': 0, '2': 7 } });
		expect(led).toHaveLength(1);
		expect(led[0].rosterId).toBe('2');
	});

	it('prefers the transaction list over legacy bonuses when both exist', () => {
		const txns = [txn({ id: 'a', rosterId: '1', amount: 2 })];
		const led = resolveLedger({ faabTransactions: txns, faabBonuses: { '9': 99 } });
		expect(led).toEqual(txns);
	});

	it('returns empty when neither is set', () => {
		expect(resolveLedger({})).toEqual([]);
	});
});

describe('sortLedger', () => {
	it('orders newest first', () => {
		const sorted = sortLedger([
			txn({ id: 'old', createdAt: 100 }),
			txn({ id: 'new', createdAt: 900 }),
			txn({ id: 'mid', createdAt: 500 }),
		]);
		expect(sorted.map((t) => t.id)).toEqual(['new', 'mid', 'old']);
	});
});
