import { scrubSecretInputs } from './secret-inputs';
export function enhanceCards(host: HTMLElement) {
  host.querySelectorAll<HTMLElement>('#transfer-panels>.card,.native-transfer-grid>.card,.asset-transfer-grid>.card,.directory-grid>.card,.asset-inventory').forEach(card=>{
    if(card.querySelector(':scope > .ui-card-banner')) return;
    const heading=card.querySelector<HTMLElement>(':scope > .section-heading,:scope > h2'); if(!heading) return;
    const title=heading.querySelector('h2')?.textContent || heading.textContent || '';
    const lower=title.toLowerCase();
    const [icon,label,caption]=lower.includes('send')?['↗','MOVE ASSETS','Choose a recipient. Review before you send.']:lower.includes('receive')?['↙','YOUR RECEIVING DETAILS','Share your public address on the selected network.']:lower.includes('collection')||lower.includes('tokens')?['◇','YOUR ASSETS','Balances and token details, together.']:lower.includes('add a contact')?['＋','ADDRESS BOOK','Save a recipient you have confirmed yourself.']:lower.includes('saved contacts')?['◇','YOUR RECIPIENTS','Find the right address before sending.']:lower.includes('add an account')?['◉','WATCH ONLY','Follow a public address without importing keys.']:['◈','ACCOUNT OVERVIEW','Public information for your selected network.'];
    const banner=document.createElement('div'); banner.className='ui-card-banner';
    const badge=document.createElement('span'); badge.className='ui-card-symbol'; badge.textContent=icon; badge.setAttribute('aria-hidden','true');
    const body=document.createElement('div'); body.className='ui-card-heading';
    const kicker=document.createElement('div'); kicker.className='ui-card-kicker'; kicker.textContent=label;
    const help=document.createElement('p'); help.textContent=caption;
    card.prepend(banner); body.append(kicker,heading,help); banner.append(badge,body); card.classList.add('ui-action-card');
  });
}

export function mountEntryTabs(host: HTMLElement) {
  const card=host.querySelector<HTMLElement>('.auth-card'); if(!card) return;
  const title=card.querySelector<HTMLElement>(':scope > h1'), intro=title?.nextElementSibling;
  const backup=card.querySelector<HTMLElement>('.restore-backup'), phrase=card.querySelector<HTMLElement>('.restore-phrase');
  const saved=card.querySelector<HTMLElement>(':scope > details:last-of-type');
  if(!title||!backup||!phrase||!saved) return;
  const nav=document.createElement('div'); nav.className='entry-tabs'; nav.setAttribute('role','tablist'); nav.setAttribute('aria-label','Wallet access');
  const unlock=document.createElement('section'), restore=document.createElement('section'), wallets=document.createElement('section');
  const panes=[unlock,restore,wallets];
  const eyebrow=card.querySelector(':scope > .eyebrow'); eyebrow?.remove();
  unlock.append(title); if(intro) unlock.append(intro);
  for(const selector of ['#vault-form','.auth-encryption-note','.auth-alternatives']) { const el=card.querySelector(selector); if(el) unlock.append(el); }
  restore.innerHTML='<div class="entry-pane-heading"><span class="entry-pane-icon" aria-hidden="true">↥</span><h2>Restore access.</h2><p>Bring your wallet to this browser with an encrypted backup or a test recovery phrase.</p></div>';
  restore.append(backup,phrase);
  wallets.innerHTML='<div class="entry-pane-heading"><span class="entry-pane-icon" aria-hidden="true">▤</span><h2>Your saved wallets.</h2><p>Choose a wallet, then unlock it with its own password.</p></div>';
  wallets.append(saved); (saved as HTMLDetailsElement).open=true; saved.classList.add('entry-saved-list');
  const labels=[card.querySelector('#confirm')?'Create':'Unlock','Restore','Saved wallets'];
  const select=(index:number)=>{
    panes.forEach((pane,i)=>{if(i!==index) scrubSecretInputs(pane);pane.hidden=i!==index; const button=nav.children[i] as HTMLButtonElement; button.setAttribute('aria-selected',String(i===index));button.tabIndex=i===index?0:-1;});
  };
  panes.forEach((pane,index)=>{
    pane.className='entry-pane'; pane.id=`entry-pane-${index}`; pane.setAttribute('role','tabpanel');pane.setAttribute('aria-labelledby',`entry-tab-${index}`);
    const button=document.createElement('button'); button.type='button';button.id=`entry-tab-${index}`;button.textContent=labels[index];button.setAttribute('role','tab');button.setAttribute('aria-controls',pane.id);button.onclick=()=>select(index);
    button.onkeydown=event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?2:(index+(event.key==='ArrowRight'?1:2))%3;select(next);(nav.children[next] as HTMLButtonElement).focus();}};
    nav.append(button);
  });
  const top=card.querySelector('.auth-card-top'); top?.after(nav); nav.after(...panes); card.classList.add('entry-console'); select(0);
  // Keep form validation visible when a browser reports an invalid field.
  card.addEventListener('invalid',event=>{const index=panes.findIndex(p=>p.contains(event.target as Node));if(index>=0)select(index);},true);
}
