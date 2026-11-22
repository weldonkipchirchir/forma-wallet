import { describe, expect, it } from 'vitest';
import { tokenInterface } from './token-data';
import { simulationFailure, tokenSimulation } from './simulation';

describe('basic eth_call simulation', () => {
  it('surfaces a bounded revert reason without claiming full simulation coverage', () => {
    const message = simulationFailure({ shortMessage: 'execution reverted: Not enough allowance', message: 'long provider detail' });
    expect(message).toContain('Not enough allowance');
    expect(message).toContain('Nothing was signed or broadcast');
    expect(message).toContain('not a balance-change preview');
    expect(message).not.toContain('long provider detail');
  });
  it('prefers a decoded revert reason over generic ethers messages', () => {
    const message = simulationFailure({ reason: 'mock approval rejection', shortMessage: 'missing revert data', message: 'missing revert data (action=call)' });
    expect(message).toContain('mock approval rejection');
    expect(message).not.toContain('missing revert data');
  });
  it('sanitizes control characters and truncates oversized provider messages', () => {
    const message = simulationFailure({ message: `bad\u0000input\n${'x'.repeat(500)}` });
    expect(message).not.toContain('\u0000');
    expect(message.length).toBeLessThan(420);
    expect(simulationFailure({})).toContain('RPC call failed');
  });
  it('accepts no-return tokens but rejects false or malformed token results', () => {
    const ok = tokenInterface.encodeFunctionResult('approve', [true]);
    const rejected = tokenInterface.encodeFunctionResult('approve', [false]);
    expect(tokenSimulation('0x', 'approve')).toBe('ok');
    expect(tokenSimulation(ok, 'approve')).toBe('ok');
    expect(tokenSimulation(rejected, 'approve')).toBe('rejected');
    expect(() => tokenSimulation('0x1234', 'approve')).toThrow('Unexpected token simulation response');
  });
});
