import { describe, expect, it } from 'vitest';
import { zeroPadValue, type Filter, type TransactionRequest } from 'ethers';
import { tokenInterface } from './token-data';
import { discoverEvmTokens, tokenDiscoveryPreferenceKey, TRANSFER_TOPIC, type DiscoveryProvider } from './token-discovery';
const owner = '0x' + '11'.repeat(20), other = '0x' + '22'.repeat(20), contract = '0x' + '33'.repeat(20);
const log = (address = contract) => ({ address, topics: [TRANSFER_TOPIC, zeroPadValue(other, 32), zeroPadValue(owner, 32)], data: '0x' + '1'.padStart(64, '0'), blockNumber: 10000, removed: false });
function fixture(logs: unknown[] = [log()]) {
  const filters: Filter[] = [], calls: TransactionRequest[] = []; let active = 0, maxActive = 0;
  const provider: DiscoveryProvider = {
    getNetwork: async () => ({ chainId: 84532n }), getBlockNumber: async () => 10000,
    getLogs: async filter => { filters.push(filter); return logs; }, getCode: async () => '0x6000',
    call: async tx => { calls.push(tx); active++; maxActive = Math.max(maxActive, active); await Promise.resolve(); active--;
      const request = tokenInterface.parseTransaction({ data: String(tx.data) })!;
      return tokenInterface.encodeFunctionResult(request.name, [request.name === 'decimals' ? 6 : request.name === 'balanceOf' ? 123n : request.name === 'name' ? 'Unverified USD' : 'USDT']);
    },
  };
  return { provider, filters, calls, max: () => maxActive };
}
describe('bounded chain-scoped token discovery', () => {
  it('scopes opt-in detection preferences to the exact chain and account', () => {
    expect(tokenDiscoveryPreferenceKey(owner, 1n)).not.toBe(tokenDiscoveryPreferenceKey(owner, 84532n));
    expect(tokenDiscoveryPreferenceKey(owner, 84532n)).not.toBe(tokenDiscoveryPreferenceKey(other, 84532n));
    expect(() => tokenDiscoveryPreferenceKey(owner, 0n)).toThrow();
  });
  it('filters exact incoming owner events in the latest5000blocks and verifies actual balance', async () => {
    const f = fixture(), result = await discoverEvmTokens({ owner, chainId: 84532n, provider: f.provider });
    expect(f.filters[0]).toEqual({ fromBlock: 5001, toBlock: 10000, topics: [TRANSFER_TOPIC, null, zeroPadValue(owner, 32)] });
    expect(result.tokens).toEqual([{ address: contract, name: 'Unverified USD', symbol: 'USDT', decimals: 6 }]);
    expect(result.warnings.join(' ')).toContain('do not verify authenticity');
    expect(f.calls.every(call => call.to === contract && !call.value)).toBe(true);
  });
  it('rejects wrong chain and stale sessions without returning candidate results', async () => {
    const f = fixture(); await expect(discoverEvmTokens({ owner, chainId: 1n, provider: f.provider })).rejects.toThrow('Wrong network');
    expect(f.filters).toEqual([]);
    let current = true; f.provider.getCode = async () => { current = false; return '0x6000'; };
    await expect(discoverEvmTokens({ owner, chainId: 84532n, provider: f.provider, current: () => current })).rejects.toThrow('changed');
  });
  it('ignores NFT, wrongrecipient, removed and outside-window events', async () => {
    const valid = log();
    const f = fixture([{ ...valid, topics: [...valid.topics, zeroPadValue('0x01', 32)] }, { ...valid, topics: [TRANSFER_TOPIC, valid.topics[1], zeroPadValue(other, 32)] }, { ...valid, removed: true }, { ...valid, blockNumber: 1 }, { ...valid, data: '0x00' }]);
    expect((await discoverEvmTokens({ owner, chainId: 84532n, provider: f.provider })).tokens).toEqual([]);
    expect(f.calls).toEqual([]);
  });
  it('deduplicates, caps200rawlogs/20contracts and never exceeds3RPCcalls', async () => {
    const f = fixture(Array.from({ length: 1000 }, (_, i) => log('0x' + (i + 1000).toString(16).padStart(40, '0'))));
    const result = await discoverEvmTokens({ owner, chainId: 84532n, provider: f.provider });
    expect(result.scannedLogs).toBe(200); expect(result.candidates).toBe(20); expect(result.tokens).toHaveLength(20); expect(result.limited).toBe(true); expect(f.max()).toBeLessThanOrEqual(3);
    const repeated = fixture(Array.from({ length: 30 }, () => log())); expect((await discoverEvmTokens({ owner, chainId: 84532n, provider: repeated.provider })).candidates).toBe(1);
  });
  it('omits contracts with no code, zero balance or unsafe metadata', async () => {
    const f = fixture(); f.provider.getCode = async () => '0x'; expect((await discoverEvmTokens({ owner, chainId: 84532n, provider: f.provider })).tokens).toEqual([]);
    const z = fixture(), original = z.provider.call;
    z.provider.call = async tx => tokenInterface.parseTransaction({ data: String(tx.data) })!.name === 'balanceOf' ? tokenInterface.encodeFunctionResult('balanceOf', [0n]) : original(tx);
    expect((await discoverEvmTokens({ owner, chainId: 84532n, provider: z.provider })).tokens).toEqual([]);
    const bad = fixture(), call = bad.provider.call;
    bad.provider.call = async tx => tokenInterface.parseTransaction({ data: String(tx.data) })!.name === 'symbol' ? tokenInterface.encodeFunctionResult('symbol', ['bad\u202ename']) : call(tx);
    expect((await discoverEvmTokens({ owner, chainId: 84532n, provider: bad.provider })).tokens).toEqual([]);
  });
});
