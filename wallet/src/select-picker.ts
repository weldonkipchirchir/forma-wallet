export type PickerOption = { value: string; label: string; disabled: boolean; index: number };
export function searchPickerOptions(options: PickerOption[], query: string) {
  const text = query.trim().toLocaleLowerCase().slice(0, 100);
  return options.filter(option => !text || option.label.toLocaleLowerCase().includes(text) || option.value.toLocaleLowerCase().includes(text)).slice(0, 100);
}
export function movePickerOption(options: PickerOption[], active: number, direction: 1 | -1) {
  if (!options.some(option => !option.disabled)) return -1;
  let index = active;
  for (let count = 0; count < options.length; count++) {
    index = (index + direction + options.length) % options.length;
    if (!options[index].disabled) return index;
  }
  return -1;
}

/** Keep native values/validation/events while replacing mobile OS select sheets. */
export function installSelectPickers(root: HTMLElement) {
  const controllers = new Map<HTMLSelectElement, { sync(): void; dispose(): void }>();
  let sequence = 0;
  function upgrade(select: HTMLSelectElement) {
    if (controllers.has(select) || select.multiple || select.size > 1) return;
    const ownerDocument = select.ownerDocument;
    const wrapper = ownerDocument.createElement('div'); wrapper.className = 'select-picker';
    const trigger = ownerDocument.createElement('button'); trigger.type = 'button'; trigger.className = 'select-picker-trigger';
    const panel = ownerDocument.createElement('div'); panel.className = 'select-picker-panel'; panel.hidden = true;
    const search = ownerDocument.createElement('input'); search.type = 'search'; search.autocomplete = 'off'; search.placeholder = 'Search options…'; search.className = 'select-picker-search';
    const list = ownerDocument.createElement('div'); list.className = 'select-picker-options'; list.setAttribute('role', 'listbox');
    const message = ownerDocument.createElement('p'); message.className = 'select-picker-message'; message.setAttribute('role', 'status');
    const id = `forma-picker-${++sequence}`; list.id = `${id}-list`; panel.id = `${id}-panel`;
    const name = select.getAttribute('aria-label') || Array.from(select.labels || []).map(label => {
      const copy = label.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('select,button,input,.select-picker').forEach(node => node.remove());
      return copy.textContent?.trim();
    }).filter(Boolean).join(' ') || 'Choose an option';
    trigger.setAttribute('aria-label', name); trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false'); trigger.setAttribute('aria-controls', panel.id);
    search.setAttribute('aria-label', `Search ${name}`); search.setAttribute('role', 'combobox'); search.setAttribute('aria-autocomplete', 'list'); search.setAttribute('aria-controls', list.id); search.setAttribute('aria-expanded', 'true');
    panel.append(search, list, message);
    select.before(wrapper); wrapper.append(select, trigger); ownerDocument.body.append(panel);
    const previousHidden = select.hidden, previousTabIndex = select.tabIndex, previousAriaHidden = select.getAttribute('aria-hidden');
    select.hidden = true; select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
    let options: PickerOption[] = [], filtered: PickerOption[] = [], active = -1, open = false, disposed = false;
    const labelListeners: { label: HTMLLabelElement; click: (event: MouseEvent) => void }[] = [];
    for (const label of Array.from(select.labels || [])) {
      const click = (event: MouseEvent) => { if (wrapper.contains(event.target as Node)) return; event.preventDefault(); trigger.focus(); };
      label.addEventListener('click', click); labelListeners.push({ label, click });
    }
    function close(focus = false) {
      open = false; panel.hidden = true; trigger.setAttribute('aria-expanded', 'false');
      if (focus && wrapper.isConnected && !trigger.disabled) trigger.focus();
    }
    function highlight() {
      Array.from(list.children).forEach((node, index) => node.classList.toggle('is-highlighted', index === active));
      const item = active < 0 ? undefined : list.children[active] as HTMLElement;
      if (item) { search.setAttribute('aria-activedescendant', item.id); item.scrollIntoView({ block: 'nearest' }); }
      else search.removeAttribute('aria-activedescendant');
    }
    function choose(index: number) {
      const option = filtered[index]; if (!option || option.disabled || select.disabled) return;
      close(true); select.value = option.value;
      trigger.removeAttribute('aria-invalid'); trigger.removeAttribute('aria-describedby');
      sync();
      select.dispatchEvent(new Event('input', { bubbles: true }));
      if (select.isConnected) select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    function renderOptions() {
      filtered = searchPickerOptions(options, search.value); list.replaceChildren();
      filtered.forEach((option, index) => {
        const item = ownerDocument.createElement('div'); item.className = 'select-picker-option'; item.id = `${id}-option-${index}`;
        item.setAttribute('role', 'option'); item.setAttribute('aria-selected', String(option.value === select.value)); item.setAttribute('aria-disabled', String(option.disabled));
        item.textContent = option.label || 'Choose an option'; item.onmousedown = event => event.preventDefault(); item.onclick = () => choose(index); list.append(item);
      });
      active = filtered.findIndex(option => option.value === select.value && !option.disabled);
      if (active < 0) active = movePickerOption(filtered, -1, 1);
      message.textContent = !filtered.length ? 'No matching options.' : options.length > 100 && !search.value ? 'Showing the first 100 options. Search to narrow the list.' : '';
      highlight();
    }
    function position() {
      if (!open) return;
      const rect = trigger.getBoundingClientRect(), gap = 8, width = Math.min(Math.max(rect.width, 260), window.innerWidth - 24);
      const below = window.innerHeight - rect.bottom - 16, above = rect.top - 16;
      const height = Math.min(360, Math.max(160, below >= 220 || below >= above ? below : above));
      panel.style.width = `${width}px`; panel.style.maxHeight = `${height}px`;
      panel.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
      panel.style.top = `${below >= 220 || below >= above ? rect.bottom + gap : Math.max(12, rect.top - height - gap)}px`;
    }
    function show() {
      if (select.disabled || disposed) return;
      open = true; panel.hidden = false; trigger.setAttribute('aria-expanded', 'true'); search.value = ''; position(); renderOptions(); search.focus({ preventScroll: true });
    }
    function sync() {
      if (disposed) return;
      options = Array.from(select.options).filter(option => !option.hidden).map((option, index) => ({ value: option.value, label: option.label || option.text, disabled: option.disabled || (option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled), index }));
      const label=ownerDocument.createElement('span');label.className='select-picker-label';label.textContent=select.selectedOptions[0]?.label || select.selectedOptions[0]?.text || 'Choose an option';trigger.replaceChildren(label);
      trigger.disabled = select.disabled; trigger.title = trigger.textContent;
      if (select.disabled) close(); else if (open) { renderOptions(); position(); }
    }
    const outside = (event: PointerEvent) => { if (open && !wrapper.contains(event.target as Node) && !panel.contains(event.target as Node)) close(); };
    const invalid = (event: Event) => { event.preventDefault(); trigger.setAttribute('aria-invalid', 'true'); message.id = `${id}-error`; trigger.setAttribute('aria-describedby', message.id); message.textContent = 'Choose an option before continuing.'; show(); message.textContent = 'Choose an option before continuing.'; };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(true); }
      else if (event.key === 'Tab') close();
      else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (!open) show(); else { active = movePickerOption(filtered, active, event.key === 'ArrowDown' ? 1 : -1); highlight(); } }
      else if (event.key === 'Enter' && open) { event.preventDefault(); choose(active); }
      else if (event.key === 'Home' && open) { event.preventDefault(); active = movePickerOption(filtered, -1, 1); highlight(); }
      else if (event.key === 'End' && open) { event.preventDefault(); active = movePickerOption(filtered, 0, -1); highlight(); }
    };
    trigger.onclick = () => open ? close() : show(); search.oninput = renderOptions;
    trigger.addEventListener('keydown', keyboard); search.addEventListener('keydown', keyboard);
    select.addEventListener('change', sync); select.addEventListener('invalid', invalid);
    ownerDocument.addEventListener('pointerdown', outside); window.addEventListener('resize', position); window.addEventListener('scroll', position, true);
    controllers.set(select, { sync, dispose: () => {
      disposed = true; close(); panel.remove(); ownerDocument.removeEventListener('pointerdown', outside); window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true);
      select.removeEventListener('change', sync); select.removeEventListener('invalid', invalid); labelListeners.forEach(({ label, click }) => label.removeEventListener('click', click));
      select.hidden = previousHidden; select.tabIndex = previousTabIndex;
      if (previousAriaHidden === null) select.removeAttribute('aria-hidden'); else select.setAttribute('aria-hidden', previousAriaHidden);
      if (wrapper.isConnected) { wrapper.before(select); wrapper.remove(); }
      controllers.delete(select);
    } });
    sync();
  }
  const observer = new MutationObserver(records => {
    controllers.forEach((controller, select) => { if (!root.contains(select)) controller.dispose(); });
    const sync = new Set<HTMLSelectElement>();
    for (const record of records) {
      if (record.target instanceof Element) { const select = record.target.closest('select'); if (select) sync.add(select); }
      for (const node of record.addedNodes) if (node instanceof Element) {
        if (node instanceof HTMLSelectElement) upgrade(node);
        node.querySelectorAll('select').forEach(upgrade);
      }
    }
    sync.forEach(select => controllers.get(select)?.sync());
  });
  root.querySelectorAll('select').forEach(upgrade);
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'selected', 'label', 'value'], characterData: true });
  return () => { observer.disconnect(); [...controllers.values()].forEach(controller => controller.dispose()); };
}
