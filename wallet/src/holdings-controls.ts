export function holdingMatches(search: string, query: string, zero: boolean, hideZero: boolean) {
  return (!hideZero || !zero) && search.toLocaleLowerCase().includes(query.trim().slice(0, 100).toLocaleLowerCase());
}

/** View-local preferences survive balance refreshes, never persist across accounts. */
export function installHoldingsControls(root: HTMLElement) {
  const states = new WeakMap<Element, { query: string; hideZero: boolean }>();
  function apply(table: HTMLElement) {
    const scope = table.closest('section') || table;
    let state = states.get(scope);
    if (!state) { state = { query: '', hideZero: false }; states.set(scope, state); }
    const search = table.querySelector<HTMLInputElement>('[data-holdings-search]')!;
    const zero = table.querySelector<HTMLInputElement>('[data-holdings-zero]')!;
    if (search.value !== state.query) search.value = state.query;
    zero.checked = state.hideZero;
    const rows = [...table.querySelectorAll<HTMLElement>('[data-holding-row]')];
    let shown = 0;
    for (const row of rows) {
      row.hidden = !holdingMatches(row.dataset.holdingSearch || '', state.query, row.dataset.holdingZero === 'true', state.hideZero && !zero.disabled);
      if (!row.hidden) shown++;
    }
    const count = table.querySelector<HTMLElement>('[data-holdings-count]')!;
    const text = `${shown} of ${rows.length} assets shown`;
    if (count.textContent !== text) count.textContent = text;
    table.querySelector<HTMLElement>('[data-holdings-empty]')!.hidden = shown > 0;
    const reset = table.querySelector<HTMLButtonElement>('[data-holdings-reset]')!;
    reset.hidden = !state.query && !state.hideZero;
  }
  function change(event: Event) {
    const target = event.target as HTMLElement;
    const table = target.closest<HTMLElement>('[data-holdings-table]'); if (!table) return;
    const scope = table.closest('section') || table;
    const state = states.get(scope) || { query: '', hideZero: false };
    if (target.matches('[data-holdings-search]')) state.query = (target as HTMLInputElement).value.slice(0, 100);
    else if (target.matches('[data-holdings-zero]')) state.hideZero = (target as HTMLInputElement).checked;
    else if (event.type === 'click' && target.closest('[data-holdings-reset]')) { state.query = ''; state.hideZero = false; }
    else return;
    states.set(scope, state); apply(table);
  }
  const scan = () => root.querySelectorAll<HTMLElement>('[data-holdings-table]').forEach(apply);
  const observer = new MutationObserver(scan);
  root.addEventListener('input', change); root.addEventListener('change', change); root.addEventListener('click', change);
  scan(); observer.observe(root, { childList: true, subtree: true });
  return () => { observer.disconnect(); root.removeEventListener('input', change); root.removeEventListener('change', change); root.removeEventListener('click', change); };
}
