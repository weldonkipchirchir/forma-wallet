import { tokenInterface } from './token-data';

export type TokenSimulation = 'ok' | 'rejected';

export function simulationFailure(error: unknown) {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : undefined;
  const info = record?.info as { error?: { message?: unknown } } | undefined;
  const candidates = [record?.reason, info?.error?.message, record?.shortMessage, (record?.error as { message?: unknown } | undefined)?.message, record?.message, typeof error === 'string' ? error : ''];
  let detail = candidates.find(value => typeof value === 'string' && value.trim()) as string | undefined;
  detail = (detail || 'RPC call failed')
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
  const reverted = detail.match(/execution reverted(?::\s*)?(.*)/i);
  if (reverted) detail = reverted[1].trim() || 'no revert reason supplied';
  return `Simulation failed: ${detail}. Nothing was signed or broadcast. This is basic eth_call revert detection, not a balance-change preview or PPOM-grade simulation.`;
}

export function tokenSimulation(data: string, method: 'transfer' | 'approve'): TokenSimulation {
  if (data === '0x') return 'ok';
  try { return tokenInterface.decodeFunctionResult(method, data)[0] ? 'ok' : 'rejected'; }
  catch { throw new Error('Unexpected token simulation response. Do not sign until the token contract is verified.'); }
}
