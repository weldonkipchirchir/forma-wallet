import { Subscription, type Observable } from 'rxjs';
type ActionState<T> = { status: string; output?: T; intermediateValue?: { step?: string; requiredUserInteraction?: string }; error?: unknown };
export function ledgerAction<T>(action: { observable: Observable<ActionState<T>>; cancel(): void }, signal: AbortSignal, progress: (text: string) => void, timeoutMs = 120000): Promise<T> {
  return new Promise((resolve, reject) => {
    const subscription = new Subscription(); let done = false;
    const finish = (error?: Error, output?: T) => {
      if (done) return; done = true; clearTimeout(timer); signal.removeEventListener('abort', abort); subscription.unsubscribe();
      if (error) { try { action.cancel(); } catch { /* already stopped */ } reject(error); } else resolve(output!);
    };
    const abort = () => finish(new Error('Ledger operation cancelled or disconnected. Nothing was broadcast.'));
    const timer = setTimeout(() => finish(new Error('Ledger request timed out. Reconnect and review again.')), timeoutMs);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    subscription.add(action.observable.subscribe({
      next: state => {
        if (done) return;
        const step = state.intermediateValue?.step ?? '';
        if (/blindSignTransactionFallback/i.test(step)) { finish(new Error('Blind signing is not supported. Request cancelled.')); return; }
        if (state.status === 'completed' && state.output !== undefined) finish(undefined, state.output);
        else if (state.status === 'error' || state.status === 'stopped') finish(new Error('Ledger request rejected, cancelled, or disconnected. Nothing was broadcast.'));
        else if (state.status === 'pending') progress(`On your Ledger: ${state.intermediateValue?.requiredUserInteraction ?? 'follow the device instructions'}`);
      },
      error: () => finish(new Error('Ledger connection failed. Reconnect and review again.')),
      complete: () => { if (!done) finish(new Error('Ledger operation ended without approval.')); },
    }));
  });
}
