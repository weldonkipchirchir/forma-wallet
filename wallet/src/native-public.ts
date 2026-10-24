import { enhanceCards } from './ui-panels';
import { btcRecipient, solRecipient, displayUnits, type Chain } from './multichain-core';
import { readMultiBalance, multiExplorer } from './multichain-network';
export type PublicAccount = { name: string; address: string };
const esc = (v: string) => v.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
export function publicAddress(chain: Chain, address: string) { return chain === 'btc' ? btcRecipient(address) : solRecipient(address).toBase58(); }
export function publicAccount(chain: Chain, name: string, address: string): PublicAccount {
  name = name.trim();
  if (!name || name.length > 40 || /[\u0000-\u001f\u007f<>]/.test(name)) throw new Error('Use a name of 1–40 characters without control characters or angle brackets.');
  return { name, address: publicAddress(chain, address) };
}
export function parsePublicAccounts(chain: Chain, value: unknown): PublicAccount[] {
  if (!Array.isArray(value)) return [];
  const result: PublicAccount[] = [];
  for (const row of value.slice(0,100)) try {
    if (typeof row?.name !== 'string' || typeof row?.address !== 'string') continue;
    const account = publicAccount(chain,row.name,row.address);
    if (!result.some(a => a.address === account.address || a.name.toLowerCase() === account.name.toLowerCase())) result.push(account);
  } catch { /* Ignore malformed public storage records. */ }
  return result;
}
export const publicAccountsKey = (chain: Chain, mode: string, owner: string) => `forma.public.${chain}.${mode}.v1:${mode === 'watch' ? 'browser' : owner.toLowerCase()}`;
export function mountNativePublic(host: HTMLElement, chain: Chain, mode: 'watch'|'contacts', owner: string, hidden: () => boolean) {
  let disposed = false, epoch = 0, message = '';
  const key = publicAccountsKey(chain,mode,owner), network = chain === 'btc' ? 'Bitcoin Testnet3' : 'Solana Devnet';
  let rows: PublicAccount[];
  try { rows = parsePublicAccounts(chain,JSON.parse(localStorage.getItem(key) || '[]')); } catch { rows = []; }
  const paint = () => {
    if (disposed) return;
    host.classList.remove('card'); host.classList.add('directory-workspace');
    host.innerHTML = `<div class="workspace-intro"><span class="pill">${network}${mode==='watch'?' · READ ONLY':''}</span><p>${mode==='watch'?'Follow public balances without importing keys. Watching an address does not prove ownership.':'Your address book. Save only addresses you have confirmed directly with the recipient.'}</p></div><p role="status" class="workspace-status">${esc(message)}</p><div class="directory-grid"><section class="card"><div class="section-heading"><h2>${mode==='watch'?'Add an account':'Add a contact'}</h2><span aria-hidden="true">＋</span></div><form><label>Name<input name="name" placeholder="e.g. My test wallet" maxlength="40" required autocomplete="off"></label><label>Full public address<input name="address" placeholder="${chain==='btc'?'tb1q…':'Solana wallet address'}" maxlength="90" required autocomplete="off"></label><label class="check"><input name="verified" type="checkbox" required> I confirmed the full address and ${network} network.</label><button class="primary">${mode==='watch'?'Add watch-only account':'Save contact'} →</button></form><p class="hint">Saved unencrypted in this browser. ${mode==='watch'?'Refresh shares this public address with the testnet service. No signing or sending is available here.':'Contacts are not independently authenticated.'} ${chain==='sol'?'A Solana address does not identify its network.':'Native SegWit tb1q accounts only.'}</p></section><section class="card"><div class="section-heading"><h2>${mode==='watch'?'Watched accounts':'Saved contacts'}</h2><span class="pill">${rows.length} / 100</span></div>${rows.map((row,i)=>`<div class="directory-row"><span class="asset-avatar" aria-hidden="true">${mode==='watch'?'◉':'◇'}</span><div class="directory-identity"><strong>${esc(row.name)}</strong><code>${esc(row.address)}</code>${mode==='watch'?`<p data-balance="${i}" class="directory-balance">Refresh to load balance</p>`:''}<a href="${multiExplorer(chain,'address',row.address)}" target="_blank" rel="noopener noreferrer">Explorer ↗</a><div class="directory-actions">${mode==='watch'?`<button class="quiet" data-refresh="${i}">↻ Refresh balance</button>`:''}<button class="text-button" data-remove="${i}">Remove</button></div></div></div>`).join('') || `<div class="empty"><span class="empty-symbol" aria-hidden="true">${mode==='watch'?'◉':'◇'}</span><h3>${mode==='watch'?'A clear view. No keys needed.':'Your people, in one place.'}</h3><p>${mode==='watch'?'Add a public address to follow its balance.':'Add a verified address to find it when sending.'}</p></div>`}</section></div>`;
    enhanceCards(host);
    host.querySelector('form')!.onsubmit = event => {
      event.preventDefault();
      try {
        const form = event.currentTarget as HTMLFormElement, data = new FormData(form);
        if (!data.get('verified')) throw new Error('Confirm the address and network first.');
        const row = publicAccount(chain,String(data.get('name')),String(data.get('address')));
        if (rows.length >= 100 || rows.some(a => a.address === row.address || a.name.toLowerCase() === row.name.toLowerCase())) throw new Error('Duplicate contact or account limit reached.');
        const next = [...rows,row]; localStorage.setItem(key,JSON.stringify(next)); rows=next; message='Saved locally.';
      } catch(e) { message=e instanceof Error ? e.message : 'Could not save.'; }
      epoch++; paint();
    };
    host.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach(button => button.onclick = () => {
      if (button.dataset.confirm !== 'yes') { button.dataset.confirm='yes'; button.textContent='Confirm removal'; return; }
      try { const next=rows.filter((_,i)=>i!==Number(button.dataset.remove)); localStorage.setItem(key,JSON.stringify(next)); rows=next; message='Removed locally.'; } catch { message='Could not remove.'; }
      epoch++; paint();
    });
    host.querySelectorAll<HTMLButtonElement>('[data-refresh]').forEach(button => button.onclick = async () => {
      const index=Number(button.dataset.refresh), version=epoch, target=host.querySelector<HTMLElement>(`[data-balance="${index}"]`)!;
      button.disabled=true; target.textContent='Loading…';
      try {
        const address=rows[index].address, balance=await readMultiBalance(chain,{btcAddress:address,solAddress:address});
        if (!disposed && version===epoch) target.textContent=hidden() ? '••••••' : `${displayUnits(balance.confirmed,chain==='btc'?8:9)} ${chain==='btc'?'tBTC':'devSOL'}${balance.unconfirmed ? ' · pending balance also present' : ''}`;
      } catch(e) { if (!disposed && version===epoch) target.textContent=e instanceof Error ? e.message : 'Balance unavailable.'; }
      finally { if (!disposed && version===epoch) button.disabled=false; }
    });
  };
  paint(); return () => { disposed=true; epoch++; host.replaceChildren(); };
}
