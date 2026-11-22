import type { Token } from './token-data';
import { discoverEvmTokens, tokenDiscoveryPreferenceKey, type DiscoveryProvider } from './token-discovery';

export function mountTokenDiscovery(host: HTMLElement, options: {
  owner: string; chainId: bigint; provider: DiscoveryProvider; current(): boolean;
  onImport(token: Token): void | Promise<void>;
  isTracked?(token: Token): boolean;
  /** Initial balances may finish before an opted-in automatic scan begins. */
  ready?(): Promise<void>; autoStart?: boolean;
}) {
  let disposed = false, busy = false, operation = 0;
  const live = () => !disposed && options.current() && host.isConnected;
  const preferenceKey = tokenDiscoveryPreferenceKey(options.owner, options.chainId);
  let automatic = false;
  try { automatic = localStorage.getItem(preferenceKey) === 'true'; } catch { /* Manual discovery remains available. */ }
  host.innerHTML = '<div class="section-heading"><h3>Find tokens you already hold</h3><button type="button" class="quiet" data-discovery-find>Find tokens</button></div><p class="hint">Search recent incoming ERC-20 transfers on this network, then verify positive balances. You choose which unverified contracts to add. No token approvals are requested.</p><label class="check"><input type="checkbox" data-discovery-auto> Auto-find when opening tokens on this account and network</label><p class="hint">Off by default. This requests recent account activity from this network’s RPC; discovered assets still require your confirmation.</p><p data-discovery-status role="status" class="hint"></p><div data-discovery-results></div>';
  const status = host.querySelector<HTMLElement>('[data-discovery-status]')!, results = host.querySelector<HTMLElement>('[data-discovery-results]')!, find = host.querySelector<HTMLButtonElement>('[data-discovery-find]')!, auto = host.querySelector<HTMLInputElement>('[data-discovery-auto]')!;
  auto.checked = automatic;
  const message = (text: string, error = false) => { if (live()) { status.textContent = text; status.setAttribute('role', error ? 'alert' : 'status'); } };
  const scan = () => { if (busy || !live()) return; busy = true; find.disabled = true; const version = ++operation; results.replaceChildren(); message('Checking recent incoming transfers and contract balances…');
    void Promise.resolve().then(() => options.ready?.()).then(() => discoverEvmTokens({ ...options, current: () => live() && version === operation })).then(result => {
      if (!live() || version !== operation) return;
      message(`${result.tokens.length} positive-balance candidate(s), blocks ${result.fromBlock}–${result.toBlock}. ${result.warnings.join(' ')}`);
      for (const token of result.tokens) {
        const row = document.createElement('div'); row.className = 'asset-row';
        const identity = document.createElement('div'), label = document.createElement('strong'), address = document.createElement('code'), hint = document.createElement('p');
        label.textContent = `${token.symbol} · ${token.name}`; address.textContent = token.address; hint.textContent = 'Unverified contract · confirm this network and issuer'; hint.className = 'hint'; identity.append(label, address, hint);
        const add = document.createElement('button'); add.type = 'button'; add.className = 'quiet'; add.textContent = options.isTracked?.(token) ? 'Already tracked' : 'Add token'; add.disabled = !!options.isTracked?.(token);
        add.onclick = () => { if (!live() || busy) return; if (options.isTracked?.(token)) { add.disabled = true; add.textContent = 'Already tracked'; message('This contract is already in this account’s token list. Check hidden tokens if it is not visible.'); return; } busy = true; add.disabled = true;
          void Promise.resolve().then(() => { if (!live()) throw new Error('Wallet changed.'); return options.onImport(token); }).then(() => { if (live()) { add.textContent = 'Added'; message(`${token.symbol} added to this account and network. Its identity remains unverified.`); } }).catch(() => { if (live()) { add.disabled = false; message('Could not add this token. Check its address, storage and token-list limit.', true); } }).finally(() => { busy = false; });
        };
        row.append(identity, add); results.append(row);
      }
    }).catch(() => message('Token discovery unavailable. Verify this network and RPC, or import a contract manually.', true)).finally(() => { if (live() && version === operation) { busy = false; find.disabled = false; } });
  };
  find.onclick = scan;
  auto.onchange = () => {
    if (!live()) return;
    try { localStorage.setItem(preferenceKey, String(auto.checked)); automatic = auto.checked; message(automatic ? 'Auto-find enabled for this account and network. Adding each result still needs confirmation.' : 'Auto-find disabled. You can still find tokens manually.'); if (automatic) scan(); }
    catch { auto.checked = automatic; message('Discovery preference could not be saved. Manual discovery is still available.', true); }
  };
  if (automatic && options.autoStart !== false) scan();
  return () => { disposed = true; operation++; host.replaceChildren(); };
}
