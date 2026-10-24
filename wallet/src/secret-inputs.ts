/** Best-effort DOM cleanup; this cannot erase browser swap, autofill or JS strings. */
export function scrubSecretInputs(host: ParentNode) {
  host.querySelectorAll<HTMLInputElement>('input[type="password"],input[data-secret-input],.password-field input').forEach(input=>{
    input.value=''; input.defaultValue=''; input.removeAttribute('value'); input.type='password';
    const toggle=input.parentElement?.querySelector<HTMLButtonElement>('.password-toggle');
    if(toggle) {toggle.textContent='Show';toggle.setAttribute('aria-pressed','false');toggle.setAttribute('aria-label',`Show ${input.labels?.[0]?.textContent || 'password'}`);}
  });
}
