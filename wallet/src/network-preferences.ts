import { isNetworkId, networkIds, type NetworkId } from './network-context';
export const NETWORK_PREFS_KEY = 'forma.network-preferences.v1';
export type NetworkPreferences = { favorites: NetworkId[]; hidden: NetworkId[] };
export function parseNetworkPreferences(raw: string | null): NetworkPreferences {
  try {
    const value = JSON.parse(raw || '{}');
    const ids = (list: unknown): NetworkId[] => Array.isArray(list) ? [...new Set(list.filter((id): id is NetworkId => typeof id === 'string' && isNetworkId(id)))].slice(0, networkIds.length) : [];
    return { favorites: ids(value?.favorites), hidden: ids(value?.hidden) };
  } catch { return { favorites: [], hidden: [] }; }
}
export function orderedNetworks(preferences: NetworkPreferences, selected: NetworkId): NetworkId[] {
  const visible = networkIds.filter(id => id === selected || !preferences.hidden.includes(id));
  return [...visible.filter(id => preferences.favorites.includes(id)), ...visible.filter(id => !preferences.favorites.includes(id))];
}
export function preferredNetworks(store: Pick<Storage, 'getItem'>, selected: NetworkId) {
  try { return orderedNetworks(parseNetworkPreferences(store.getItem(NETWORK_PREFS_KEY)), selected); }
  catch { return [...networkIds]; }
}
