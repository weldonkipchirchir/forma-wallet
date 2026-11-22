import { evmNetworks, isAdditionalEvm } from './evm-networks';
import { networkAsset, networkIds, isMainnetNetwork, type NetworkId } from './network-context';
import { NETWORK_PREFS_KEY, parseNetworkPreferences } from './network-preferences';
import { assetLogo } from './asset-display';
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function mountNetworkManager(host: HTMLElement, selected: NetworkId, choose: (id: NetworkId) => void, changed: () => void) {
  let query = '', family = 'all', environment = 'all', disposed = false;
  const prefs = () => { try { return parseNetworkPreferences(localStorage.getItem(NETWORK_PREFS_KEY)); } catch { return { favorites: [], hidden: [] }; } };
  const configFor = (id: NetworkId) => isAdditionalEvm(id) ? evmNetworks[id] : id === 'eth' ? { chainId: 11155111, rpc: import.meta.env.VITE_SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com', docs: 'https://ethereum.org/en/developers/docs/networks/#sepolia' } : undefined;
  const isEvm = (id: NetworkId) => id === 'eth' || isAdditionalEvm(id);
  function results() {
    const settings = prefs();
    const list = networkIds.filter(id => {
      const asset = networkAsset(id), config = configFor(id);
      return (environment === 'all' || (environment === 'mainnet' ? isMainnetNetwork(id) : !isMainnetNetwork(id))) && (family === 'all' || (family === 'evm' ? isEvm(id) : !isEvm(id))) && [asset.name, asset.network, asset.symbol, config ? String(config.chainId) : ''].some(value => value.toLowerCase().includes(query.trim().toLowerCase()));
    });
    host.querySelector('#network-result-count')!.textContent = `${list.length} of ${networkIds.length} supported networks`;
    host.querySelector('#network-results')!.innerHTML = list.map(id => {
      const asset = networkAsset(id), config = configFor(id);
      return `<article class="network-manager-card${id === selected ? ' is-selected' : ''}"><div class="network-card-heading"><span class="network-family-badge">${isEvm(id) ? 'EVM' : (id === 'sol' || id === 'sol-mainnet') ? 'Solana' : id === 'tron' ? 'TRON' : 'Bitcoin'}</span><span>${id === selected ? 'Selected' : settings.hidden.includes(id) ? 'Hidden in selector' : isMainnetNetwork(id) ? 'MAINNET · real funds' : 'Testnet'}</span></div><h2>${assetLogo(asset.symbol, true)} ${escape(asset.network)}</h2><p>Gas token: <strong>${escape(asset.symbol)}</strong>${config ? ` · Chain ID ${config.chainId}` : ''}</p><p class="hint">${isEvm(id) ? 'Native gas token and imported standard ERC-20 contracts.' : (id === 'sol' || id === 'sol-mainnet') ? 'Native SOL and classic SPL tokens. Token-2022 unavailable.' : id === 'tron' ? 'Nile TRX and TRC-20 receiving and tracking. Signing is unavailable.' : 'Native Bitcoin transfers. No token protocols enabled.'}</p>${config ? `<p class="network-rpc">${escape(new URL(config.rpc).origin)}</p><a href="${config.docs}" target="_blank" rel="noopener noreferrer">Official network reference ↗</a>` : ''}<div class="network-card-actions"><button type="button" class="primary" data-network-use="${id}" ${id === selected ? 'disabled' : ''}>${id === selected ? 'Current network' : 'Switch network'}</button><button type="button" class="quiet" data-network-favorite="${id}" aria-pressed="${settings.favorites.includes(id)}">${settings.favorites.includes(id) ? '★ Favorite' : '☆ Favorite'}</button><button type="button" class="quiet" data-network-hide="${id}" ${id === selected ? 'disabled' : ''}>${settings.hidden.includes(id) ? 'Show in selector' : 'Hide in selector'}</button></div></article>`;
    }).join('') || '<p class="empty">No supported networks match. Clear your search or change the family filter.</p>';
    host.querySelectorAll<HTMLButtonElement>('[data-network-use]').forEach(button => button.onclick = () => { if (!disposed) choose(button.dataset.networkUse as NetworkId); });
    const update = (id: NetworkId, key: 'favorites' | 'hidden') => {
      if (disposed || (id === selected && key === 'hidden')) return;
      try { const state = prefs(); state[key] = state[key].includes(id) ? state[key].filter(value => value !== id) : [...state[key], id]; localStorage.setItem(NETWORK_PREFS_KEY, JSON.stringify(state)); results(); changed(); }
      catch { host.querySelector('#network-message')!.textContent = 'Preferences could not be saved. Check browser storage availability.'; }
    };
    host.querySelectorAll<HTMLButtonElement>('[data-network-favorite]').forEach(button => button.onclick = () => update(button.dataset.networkFavorite as NetworkId, 'favorites'));
    host.querySelectorAll<HTMLButtonElement>('[data-network-hide]').forEach(button => button.onclick = () => update(button.dataset.networkHide as NetworkId, 'hidden'));
  }
  host.innerHTML = `<section class="network-manager-intro"><span class="pill">${networkIds.length} supported networks</span><h2>Find your network.</h2><p>Keep favorites close and hide networks you do not use. Token contracts and balances belong to their selected chain, even when an EVM receiving address is shared.</p></section><div class="network-manager-toolbar"><label for="network-search">Search networks<input id="network-search" type="search" maxlength="80" placeholder="Name, gas token or chain ID" autocomplete="off"></label><label for="network-environment">Environment<select id="network-environment"><option value="all">Mainnets & testnets</option><option value="mainnet">Mainnets · real funds</option><option value="testnet">Testnets only</option></select></label><label for="network-family">Network family<select id="network-family"><option value="all">All supported families</option><option value="evm">EVM</option><option value="native">Bitcoin, Solana & TRON</option></select></label></div><p id="network-result-count" class="hint" role="status"></p><p id="network-message" class="hint" role="status"></p><div id="network-results" class="network-manager-grid"></div><section class="card network-capabilities-note"><h2>Support follows a chain adapter.</h2><p>EVM presets use reviewed type-2 transaction support and credential-free RPC origins. Bitcoin and Solana have separate signing adapters; TRON Nile currently provides read-only receiving and token tracking. Adding a network does not bridge assets or verify a token’s issuer. Explicitly labelled EVM and Solana mainnets are enabled. Bitcoin stays Testnet3 and TRON stays read-only Nile. Arbitrary RPC URLs and unsupported transaction formats remain disabled.</p></section>`;
  host.querySelector<HTMLInputElement>('#network-search')!.oninput = event => { query = (event.target as HTMLInputElement).value; results(); };
  host.querySelector<HTMLSelectElement>('#network-family')!.onchange = event => { family = (event.target as HTMLSelectElement).value; results(); };
  host.querySelector<HTMLSelectElement>('#network-environment')!.onchange = event => { environment = (event.target as HTMLSelectElement).value; results(); };
  results(); return () => { disposed = true; host.replaceChildren(); };
}
