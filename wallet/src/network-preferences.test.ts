import { describe, expect, it } from 'vitest';
import { orderedNetworks, parseNetworkPreferences, preferredNetworks } from './network-preferences';
import { networkIds } from './network-context';
describe('network visibility and favorites', () => {
  it('ignores invalid/prototype IDs and deduplicates saved preferences', () => {
    expect(parseNetworkPreferences('{bad')).toEqual({ favorites: [], hidden: [] });
    expect(parseNetworkPreferences(JSON.stringify({ favorites: ['base', 'base', '__proto__'], hidden: ['robinhood', 'unknown'] }))).toEqual({ favorites: ['base'], hidden: ['robinhood'] });
  });
  it('always retains the selected network and sorts favorites before others', () => {
    const result = orderedNetworks({ favorites: ['base'], hidden: ['robinhood', 'sol'] }, 'robinhood');
    expect(result[0]).toBe('base'); expect(result).toContain('robinhood'); expect(result).not.toContain('sol');
    expect(new Set(result).size).toBe(result.length);
  });
  it('falls back to available presets when storage is unavailable', () => {
    expect(preferredNetworks({ getItem: () => { throw new Error('denied'); } }, 'eth')).toEqual(networkIds);
  });
});
