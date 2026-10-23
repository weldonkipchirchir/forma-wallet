import { describe, it, expect } from 'vitest';
import { tokenAmount, tokenAddress, tokenInterface, savedTokens, parseTokenTransfers } from './token-data';
const contract = '0x' + '1'.repeat(40), recipient = '0x' + '2'.repeat(40);
describe('ERC-20 safety boundaries', () => {
  it('uses token decimals without floating point rounding', () => {
    expect(tokenAmount('1.000001', 6)).toBe(1000001n);
    expect(tokenAmount('0.000000000000000001', 18)).toBe(1n);
    expect(tokenAmount('7', 0)).toBe(7n);
    for (const value of ['0', '-1', '1e6', '0.0000001']) expect(() => tokenAmount(value, 6)).toThrow();
  });
  it('only encodes direct transfers with the reviewed recipient and amount', () => {
    const encoded = tokenInterface.encodeFunctionData('transfer', [recipient, tokenAmount('2.5', 6)]);
    expect(encoded.slice(0, 10)).toBe('0xa9059cbb');
    const decoded = tokenInterface.decodeFunctionData('transfer', encoded);
    expect(decoded[0]).toBe(recipient);
    expect(decoded[1]).toBe(2500000n);
  });
  it('rejects zero addresses, invalid metadata and unsupported precision', () => {
    expect(() => tokenAddress('0x' + '0'.repeat(40))).toThrow();
    expect(() => tokenAmount('1', 255)).toThrow();
    expect(savedTokens([{ address: contract, name: 'Test', symbol: 'TEST', decimals: 6 }])).toHaveLength(1);
    expect(savedTokens([{ address: contract, name: 'Test', symbol: 'TEST', decimals: 255 }])).toHaveLength(0);
  });
  it('validates untrusted indexer transfer values', () => {
    const row = { transaction_hash: '0x' + 'a'.repeat(64), token: { address_hash: contract }, from: { hash: recipient }, to: { hash: contract }, total: { value: '1000000' }, timestamp: '2026-10-22T12:00:00Z', log_index: 3 };
    expect(parseTokenTransfers([row])[0].value).toBe('1000000');
    expect(parseTokenTransfers([{ ...row, transaction_hash: '<script>' }, { ...row, total: { value: '-1' } }])).toEqual([]);
  });
});
