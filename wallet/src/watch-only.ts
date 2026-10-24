import { Contract, formatEther, formatUnits, getAddress, ZeroAddress, type JsonRpcProvider } from 'ethers';
import { fetchActivity, mergeActivity, type Activity } from './activity';
import { ERC20_ABI, savedTokens, type Token } from './token-data';
import { safeTokenText } from './transfer-safety';
import { requireSepolia } from './wallet';

export type WatchedAccount = { name: string; address: string };
export const WATCH_KEY = 'forma.sepolia.watch-only.v1';
export const watchTokenKey = (address: string) => `forma.sepolia.watch-tokens.v1:${getAddress(address).toLowerCase()}`;
export function watchInput(name: string, address: string): WatchedAccount {
  if (!safeTokenText(name.trim(), 40)) throw new Error('Use a name of 1 to 40 characters without control characters.');
  if (!/^0x[\da-f]{40}$/i.test(address.trim())) throw new Error('Enter a public Ethereum address, not a recovery phrase or private key.');
  const normalized = getAddress(address.trim());
  if (normalized === ZeroAddress) throw new Error('The zero address cannot be watched.');
  return { name: name.trim(), address: normalized };
}
export function parseWatched(value: unknown): WatchedAccount[] {
  if (!Array.isArray(value)) return [];
  const rows: WatchedAccount[] = [];
  for (const entry of value.slice(0, 20)) {
    try { if (typeof entry?.name !== 'string' || typeof entry.address !== 'string') continue;
      const row = watchInput(entry.name, entry.address);
      if (!rows.some(r => r.address === row.address)) rows.push(row);
    } catch { /* Discard malformed browser storage. */ }
  }
  return rows;
}
export function addWatched(rows: WatchedAccount[], row: WatchedAccount) {
  if (rows.length >= 20) throw new Error('Up to 20 watch-only accounts are supported.');
  if (rows.some(r => r.address === row.address)) throw new Error('This address is already watched.');
  return [...rows, row];
}

// This view receives a read API, never a wallet, signer, vault or signing callback.
export type WatchReadApi = {
  network(): Promise<bigint>;
  balance(address: string): Promise<bigint>;
  tokenBalance(contract: string, address: string): Promise<bigint>;
  metadata(contract: string): Promise<Token>;
  activity(address: string, internal: boolean): Promise<Activity[]>;
};
export function watchReadApi(provider: JsonRpcProvider): WatchReadApi {
  return {
    network: async () => (await provider.getNetwork()).chainId,
    balance: address => provider.getBalance(address),
    tokenBalance: async (contract, address) => BigInt(await new Contract(contract, ERC20_ABI, provider).balanceOf(address)),
    metadata: async address => {
      if (await provider.getCode(address) === '0x') throw new Error('No Sepolia contract exists at this address.');
      const contract = new Contract(address, ERC20_ABI, provider);
      const [name, symbol, decimals] = await Promise.all([contract.name(), contract.symbol(), contract.decimals()]);
      const token = savedTokens([{ address, name, symbol, decimals: Number(decimals) }])[0];
      if (!token) throw new Error('Unsupported or deceptive token metadata.');
      return token;
    },
    activity: async (address, internal) => (await fetchActivity(address, internal)).items,
  };
}
export async function readWatched(api: WatchReadApi, address: string, tokens: Token[]) {
  requireSepolia(await api.network());
  const [balance, external, internal, ...holdings] = await Promise.allSettled([
    api.balance(address), api.activity(address, false), api.activity(address, true),
    ...tokens.map(t => api.tokenBalance(t.address, address)),
  ]);
  return { balance, history: mergeActivity([], [external, internal].flatMap(r => r.status === 'fulfilled' ? r.value as Activity[] : [])),
    historyUnavailable: external.status === 'rejected' || internal.status === 'rejected', holdings };
}

export function watchMarkup() {
  return `<section id="watch-panel" class="directory-workspace"><div class="workspace-intro"><span class="pill">ETHEREUM SEPOLIA · READ ONLY</span><p>Follow public balances without importing keys. Watching an address does not prove ownership.</p><button id="watch-own" class="text-button">← Back to my wallet</button></div><p id="watch-notice" class="workspace-status" role="status" aria-live="polite"></p><div class="directory-grid"><section class="card"><div class="section-heading"><h2>Add an account</h2><span aria-hidden="true">＋</span></div><form id="watch-add"><label for="watch-name">Account name</label><input id="watch-name" maxlength="40" placeholder="e.g. My test wallet" required autocomplete="off"><label for="watch-address">Full public address</label><input id="watch-address" required autocomplete="off" placeholder="0x…"><button class="primary">Add watch-only account →</button></form><p class="hint">Saved unencrypted in this browser. Queries share public addresses with the RPC and Blockscout. Watch-only accounts cannot sign or send.</p></section><section class="card"><div class="section-heading"><h2>Watched accounts</h2><span class="pill">READ ONLY</span></div><label for="watch-select">Watched account</label><select id="watch-select"></select><div class="directory-actions"><button id="watch-refresh" class="quiet">↻ Refresh balance</button><button id="watch-remove" class="text-button">Remove</button></div><div id="watch-summary" class="directory-summary"></div></section></div><div class="directory-grid lower"><section class="card"><div class="section-heading"><h2>Watched tokens</h2><span aria-hidden="true">◇</span></div><form id="watch-token-form"><label for="watch-token-address">Sepolia token contract</label><input id="watch-token-address" required autocomplete="off" placeholder="0x…"><button class="quiet">Track token</button></form><div id="watch-tokens"></div></section><section class="card"><div class="section-heading"><h2>Recent activity</h2><span aria-hidden="true">↗</span></div><p class="hint">Latest indexed ETH transfers. Token transfers are excluded. Use the explorer for complete history.</p><div id="watch-activity"></div></section></div></section>`;
}
const escape = (v: string) => v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function mountWatch(host: HTMLElement, api: WatchReadApi, goBack: () => void, hideBalance: () => boolean) {
  let disposed = false, revision = 0;
  let rows: WatchedAccount[];
  try { rows = parseWatched(JSON.parse(localStorage.getItem(WATCH_KEY) || '[]')); } catch { rows = []; }
  const $ = (id: string) => host.querySelector<HTMLElement>(`#${id}`)!;
  const field = (id: string) => (host.querySelector(`#${id}`) as HTMLInputElement).value;
  const message = (text: string) => { if (!disposed) $('watch-notice').textContent = text; };
  const selected = () => rows.find(r => r.address === field('watch-select'));
  function tokens(address: string) { try { return savedTokens(JSON.parse(localStorage.getItem(watchTokenKey(address)) || '[]')); } catch { return []; } }
  function options(address?: string) {
    $('watch-select').innerHTML = rows.map(r => `<option value="${r.address}">${escape(r.name)} - ${r.address}</option>`).join('') || '<option value="">No watched accounts</option>';
    if (address) (host.querySelector('#watch-select') as HTMLSelectElement).value = address;
  }
  async function refresh() {
    const current = selected(), captured = ++revision;
    $('watch-summary').replaceChildren(); $('watch-tokens').replaceChildren(); $('watch-activity').replaceChildren();
    $('watch-remove').textContent = 'Remove watched account'; delete $('watch-remove').dataset.confirm;
    if (!current) { message('Add a public address to begin.'); return; }
    const tracked = tokens(current.address);
    message('Loading public Sepolia data...');
    try {
      const data = await readWatched(api, current.address, tracked);
      if (disposed || captured !== revision) return;
      $('watch-summary').innerHTML = `<h3>${escape(current.name)}</h3><code>${current.address}</code><p>${hideBalance() ? 'Balance hidden' : data.balance.status === 'fulfilled' ? `${formatEther(data.balance.value)} Sepolia ETH` : 'ETH balance unavailable'}</p><a href="https://sepolia.etherscan.io/address/${current.address}" target="_blank" rel="noopener noreferrer">View full address activity</a>`;
      $('watch-tokens').innerHTML = tracked.map((t, i) => `<div class="tx"><div><strong>${escape(t.symbol)} (unverified)</strong><p>${t.address}</p></div><span>${hideBalance() ? 'Hidden' : data.holdings[i]?.status === 'fulfilled' ? escape(formatUnits((data.holdings[i] as PromiseFulfilledResult<bigint>).value, t.decimals)) : 'Unavailable'}</span></div>`).join('') || '<p>No tokens tracked for this watched address.</p>';
      $('watch-activity').innerHTML = data.history.map(t => `<div class="tx"><div><strong>${t.from.toLowerCase() === current.address.toLowerCase() ? 'Sent' : 'Received'} ${hideBalance() ? 'Hidden' : formatEther(t.value)} ETH</strong><p>${t.status} | ${escape(new Date(t.timestamp).toLocaleString())}</p></div><a href="https://sepolia.etherscan.io/tx/${t.hash}" target="_blank" rel="noopener noreferrer">View transaction</a></div>`).join('') || '<p>No recent activity loaded.</p>';
      message(data.historyUnavailable ? 'Some activity requests failed. Shown history is incomplete.' : 'Read-only data refreshed. No signing capability is available here.');
    } catch (e) { if (!disposed && captured === revision) message(e instanceof Error ? e.message : 'Watch-only data unavailable.'); }
  }
  $('watch-own').onclick = goBack;
  $('watch-select').onchange = () => { void refresh(); };
  $('watch-refresh').onclick = () => { void refresh(); };
  $('watch-add').onsubmit = event => {
    event.preventDefault();
    try {
      const row = watchInput(field('watch-name'), field('watch-address'));
      const next = addWatched(rows, row); localStorage.setItem(WATCH_KEY, JSON.stringify(next)); rows = next;
      (host.querySelector('#watch-add') as HTMLFormElement).reset(); options(row.address); void refresh();
    } catch (e) { message(e instanceof Error ? e.message : 'Account could not be added.'); }
  };
  $('watch-remove').onclick = () => {
    const row = selected(); if (!row) return;
    if ($('watch-remove').dataset.confirm !== 'yes') { $('watch-remove').dataset.confirm = 'yes'; $('watch-remove').textContent = 'Confirm removal'; return; }
    try { const next = rows.filter(r => r.address !== row.address); localStorage.setItem(WATCH_KEY, JSON.stringify(next)); rows = next; options(); void refresh(); } catch { message('Could not remove watched account.'); }
  };
  $('watch-token-form').onsubmit = event => {
    event.preventDefault();
    const row = selected(), captured = revision;
    if (!row) { message('Select a watched account first.'); return; }
    const input = field('watch-token-address');
    void (async () => {
      try {
        requireSepolia(await api.network());
        const address = watchInput('Token', input).address;
        const token = await api.metadata(address);
        if (disposed || captured !== revision) return;
        const tracked = tokens(row.address);
        if (tracked.length >= 25 || tracked.some(t => t.address === token.address)) throw new Error('Token already tracked, or the 25-token limit was reached.');
        localStorage.setItem(watchTokenKey(row.address), JSON.stringify([...tracked, token]));
        (host.querySelector('#watch-token-form') as HTMLFormElement).reset(); await refresh();
      } catch (e) { if (!disposed && captured === revision) message(e instanceof Error ? e.message : 'Token could not be tracked.'); }
    })();
  };
  options(); void refresh();
  return () => { disposed = true; revision++; };
}
