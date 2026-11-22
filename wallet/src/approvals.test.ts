import { describe, expect, it } from 'vitest';
import { MaxUint256 } from 'ethers';
import { allowanceLabel, approvalWarning, approvalScanPage, APPROVAL_SCAN_LIMIT, cursorQuery, isUnlimitedAllowance, parseApprovalTransactions, revokeRequest } from './approvals';
import { boundedJson } from './bounded-response';
import { tokenInterface, type Token } from './token-data';

const token: Token = { address: '0x' + '1'.repeat(40), name: 'Test token', symbol: 'TST', decimals: 6 };
const spender = '0x' + '2'.repeat(40);
const owner = '0x' + '3'.repeat(40);
const hash = '0x' + '4'.repeat(64);
const row = (overrides: Record<string, unknown> = {}) => ({
  hash,
  timestamp: '2026-11-22T00:00:00Z',
  from: { hash: owner },
  to: { hash: token.address },
  method: 'approve',
  decoded_input: { method_call: 'approve(address spender, uint256 value)', parameters: [{ name: 'spender', value: spender }, { name: 'value', value: '2500000' }] },
  raw_input: '0x',
  ...overrides,
});

describe('approval discovery', () => {
  it('caps hostile oversized pages and preserves a decreasing overall pagination budget', () => {
    const first = approvalScanPage(Array.from({ length: 150 }, () => null));
    expect(first.items).toHaveLength(150); expect(first.remaining).toBe(50);
    const second = approvalScanPage(Array.from({ length: 1000 }, () => row()), first.remaining);
    expect(second.items).toHaveLength(50); expect(second.remaining).toBe(0);
    expect(approvalScanPage([row()], second.remaining)).toEqual({ items: [], remaining: 0 });
    expect(() => approvalScanPage({}, 200)).toThrow('Unexpected');
    for (const invalid of [-1, 201, NaN, Infinity, 1.5]) expect(() => approvalScanPage([], invalid)).toThrow('budget');
  });
  it('bounds unique candidate RPC work even when an indexer sends more than 200 approvals', () => {
    const rows = Array.from({ length: 300 }, (_, index) => row({ decoded_input: { method_call: 'approve(address spender, uint256 value)', parameters: [{ name: 'spender', value: '0x' + (index + 1).toString(16).padStart(40, '0') }, { name: 'value', value: '1' }] } }));
    expect(parseApprovalTransactions(rows, [token], owner)).toHaveLength(APPROVAL_SCAN_LIMIT);
    expect(parseApprovalTransactions([...rows.slice(0, 100), ...rows.slice(0, 100)], [token], owner)).toHaveLength(100);
  });
  it('rejects over-limit declared indexer response bodies before JSON parsing', async () => {
    const response = new Response('{"items":[]}', { headers: { 'content-length': '2000001' } });
    await expect(boundedJson(response)).rejects.toThrow('supported size');
  });
  it('finds the latest successful-looking approval for tracked tokens', () => {
    const older = row({ hash: '0x' + '5'.repeat(64), timestamp: '2026-11-21T00:00:00Z', decoded_input: { method_call: 'approve(address spender, uint256 value)', parameters: [{ name: 'spender', value: spender }, { name: 'value', value: '1000000' }] } });
    const found = parseApprovalTransactions([older, row()], [token], owner);
    expect(found).toEqual([{ token: token.address, spender, value: 2500000n, hash, timestamp: '2026-11-22T00:00:00Z' }]);
  });
  it('ignores other owners, untracked tokens, pending rows and malformed data', () => {
    expect(parseApprovalTransactions([
      row({ from: { hash: '0x' + '6'.repeat(40) } }),
      row({ to: { hash: '0x' + '7'.repeat(40) } }),
      row({ timestamp: null }),
      row({ hash: '0x1234' }),
      row({ decoded_input: { parameters: [{ name: 'spender', value: '0x1234' }, { name: 'value', value: '1' }] }, method: '' }),
      row({ decoded_input: { parameters: [{ name: 'spender', value: spender }, { name: 'value', value: '-1' }] } }),
    ], [token], owner)).toEqual([]);
  });
  it('decodes raw approve calldata when the indexer does not decode it', () => {
    const raw = tokenInterface.encodeFunctionData('approve', [spender, 9_000_000n]);
    const found = parseApprovalTransactions([row({ method: '', decoded_input: null, raw_input: raw })], [token], owner);
    expect(found[0]?.spender).toBe(spender);
    expect(found[0]?.value).toBe(9_000_000n);
  });
  it('only follows safe query cursor values', () => {
    expect(cursorQuery({ block_number: 12, index: '3', filter: 'from', nested: { a: 1 }, bad_key: null })).toEqual({ block_number: '12', index: '3', filter: 'from' });
    expect(cursorQuery(null)).toBeNull();
  });
});

describe('approval revocation request', () => {
  it('encodes approve(spender, 0) without moving tokens', () => {
    const request = revokeRequest(token, spender);
    expect(request.to).toBe(token.address);
    expect(request.value).toBe(0n);
    const parsed = tokenInterface.parseTransaction({ data: request.data! });
    expect(parsed?.name).toBe('approve');
    expect(parsed?.args[0]).toBe(spender);
    expect(parsed?.args[1]).toBe(0n);
  });
  it('formats allowances and flags unlimited or near-unlimited values', () => {
    expect(isUnlimitedAllowance(MaxUint256)).toBe(true);
    expect(isUnlimitedAllowance(MaxUint256 / 2n)).toBe(true);
    expect(isUnlimitedAllowance(MaxUint256 / 2n - 1n)).toBe(false);
    expect(allowanceLabel(2_500_000n, 6, 'TST')).toBe('2.5 TST');
    expect(allowanceLabel(0n, 6, 'TST')).toBe('0.0 TST');
    expect(approvalWarning(0n, 6, 'TST', spender)).toContain('No active allowance');
    expect(approvalWarning(MaxUint256, 6, 'TST', spender)).toContain('Unlimited');
    expect(approvalWarning(2_500_000n, 6, 'TST', spender)).toContain('2.5 TST');
  });
});
