import { getAddress, ZeroAddress } from 'ethers';
import { safeTokenText } from './transfer-safety';
export type Contact = { name: string; address: string; verifiedAt: string };
export const contactsKey = (wallet: string) => `forma.sepolia.contacts.v1:${getAddress(wallet).toLowerCase()}`;
export function contactInput(name: string, address: string, verified: boolean): Contact {
  if (!verified) throw new Error('Confirm the full address directly with the recipient first.');
  name = name.trim();
  if (!safeTokenText(name, 40)) throw new Error('Use a contact name of 1 to 40 characters without control characters.');
  const normalized = getAddress(address.trim());
  if (normalized === ZeroAddress) throw new Error('Cannot save the zero address.');
  return { name, address: normalized, verifiedAt: new Date().toISOString() };
}
export function parseContacts(value: unknown): Contact[] {
  if (!Array.isArray(value)) return [];
  const result: Contact[] = [];
  for (const row of value.slice(0, 100)) {
    try {
      if (!row || typeof row.name !== 'string' || typeof row.address !== 'string' || typeof row.verifiedAt !== 'string' || !Number.isFinite(Date.parse(row.verifiedAt))) continue;
      const contact = contactInput(row.name, row.address, true);
      if (!result.some(c => c.address === contact.address || c.name.toLowerCase() === contact.name.toLowerCase())) result.push({ ...contact, verifiedAt: row.verifiedAt });
    } catch { /* Reject untrusted local storage records. */ }
  }
  return result;
}
export function loadContacts(wallet: string) { try { return parseContacts(JSON.parse(localStorage.getItem(contactsKey(wallet)) || '[]')); } catch { return []; } }
export function addContact(rows: Contact[], contact: Contact) {
  if (rows.length >= 100) throw new Error('Up to 100 contacts per wallet are supported.');
  if (rows.some(c => c.address === contact.address || c.name.toLowerCase() === contact.name.toLowerCase())) throw new Error('This name or address is already saved. Remove the old contact before replacing it.');
  return [...rows, contact];
}
export function contactNotice(address: string, contacts: Contact[]) {
  const normalized = getAddress(address).toLowerCase();
  const exact = contacts.find(c => c.address.toLowerCase() === normalized);
  if (exact) return `Saved contact: ${exact.name}. Address confirmed by you on ${new Date(exact.verifiedAt).toLocaleDateString()}. Verify the full address again; saved contacts are not independently authenticated.`;
  const similar = contacts.find(c => c.address.toLowerCase().slice(0, 6) === normalized.slice(0, 6) && c.address.toLowerCase().slice(-4) === normalized.slice(-4));
  if (similar) throw new Error(`Possible lookalike of saved contact ${similar.name}. The middle of the address differs. Obtain the full address directly from the recipient.`);
  return '';
}
const escape = (v: string) => v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function contactOptions(wallet: string) { return '<option value="">Enter an address manually</option>' + loadContacts(wallet).map(c => `<option value="${c.address}">${escape(c.name)} - ${c.address}</option>`).join(''); }
export function contactsMarkup(wallet: string) {
  const rows=loadContacts(wallet);
  return `<section id="contacts-panel" class="directory-workspace"><div class="workspace-intro"><span class="pill">ETHEREUM SEPOLIA</span><p>Your address book. Save only addresses you have confirmed directly with the recipient.</p></div><div class="directory-grid"><section class="card"><div class="section-heading"><h2>Add a contact</h2><span aria-hidden="true">＋</span></div><form id="contact-form"><label for="contact-name">Contact name</label><input id="contact-name" maxlength="40" placeholder="e.g. My test wallet" required autocomplete="off"><label for="contact-address">Full recipient address</label><input id="contact-address" required autocomplete="off" placeholder="0x…"><label class="check"><input id="contact-verified" type="checkbox" required> I confirmed the full address and Ethereum Sepolia network directly with the recipient.</label><button class="primary">Save contact →</button></form><p class="hint">Stored unencrypted in this browser for this wallet. Contacts are not independently authenticated. Remove and verify again to change an address.</p></section><section class="card"><div class="section-heading"><h2>Saved contacts</h2><span class="pill">${rows.length} / 100</span></div><div id="contact-list">${rows.map(c=>`<div class="directory-row"><span class="asset-avatar" aria-hidden="true">◇</span><div class="directory-identity"><strong>${escape(c.name)}</strong><code>${c.address}</code><p class="hint">Confirmed by you · ${escape(new Date(c.verifiedAt).toLocaleDateString())}</p></div><button class="text-button" data-remove-contact="${c.address}">Remove</button></div>`).join('') || '<div class="empty"><span class="empty-symbol" aria-hidden="true">◇</span><h3>Your people, in one place.</h3><p>Add a verified address to find it when sending.</p></div>'}</div></section></div></section>`;
}
export function mountContacts(wallet: string, redraw: () => void, report: (text: string) => void) {
  document.getElementById('contact-form')?.addEventListener('submit', event => {
    event.preventDefault();
    try {
      const contact = contactInput((document.getElementById('contact-name') as HTMLInputElement).value, (document.getElementById('contact-address') as HTMLInputElement).value, (document.getElementById('contact-verified') as HTMLInputElement).checked);
      localStorage.setItem(contactsKey(wallet), JSON.stringify(addContact(loadContacts(wallet), contact)));
      redraw(); report('Contact saved after your address confirmation.');
    } catch (e) { report(e instanceof Error ? e.message : 'Contact could not be saved.'); }
  });
  document.querySelectorAll<HTMLButtonElement>('[data-remove-contact]').forEach(button => button.onclick = () => {
    if (button.dataset.confirm !== 'yes') { button.dataset.confirm = 'yes'; button.textContent = 'Confirm removal'; return; }
    try { localStorage.setItem(contactsKey(wallet), JSON.stringify(loadContacts(wallet).filter(c => c.address !== button.dataset.removeContact))); redraw(); report('Contact removed locally.'); }
    catch { report('Contact could not be removed.'); }
  });
}
