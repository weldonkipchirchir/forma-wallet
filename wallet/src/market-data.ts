export const MARKET_API = 'https://data-api.binance.vision';
export const ranges = [
  { label: '1H', hours: 1, interval: '1m', limit: 60 },
  { label: '24H', hours: 24, interval: '15m', limit: 96 },
  { label: '7D', hours: 168, interval: '1h', limit: 168 },
  { label: '30D', hours: 720, interval: '4h', limit: 180 },
  { label: '90D', hours: 2160, interval: '12h', limit: 180 },
  { label: '180D', hours: 4320, interval: '1d', limit: 180 },
  { label: '1Y', hours: 8760, interval: '1d', limit: 365 },
  { label: 'ALL', hours: 0, interval: '1M', limit: 1000 },
] as const;
export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
export function parseCandles(raw: unknown): Candle[] {
  if (!Array.isArray(raw)) throw new Error('Invalid candle response.');
  const rows: Candle[] = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 6) throw new Error('Invalid candle response.');
    const [time, open, high, low, close, volume] = row.slice(0, 6).map(Number);
    if (![time, open, high, low, close, volume].every(Number.isFinite) || time <= 0 || Math.min(open, high, low, close) <= 0 || volume < 0 || high < Math.max(open, close, low) || low > Math.min(open, close, high)) throw new Error('Invalid candle values.');
    rows.push({ time: Math.floor(time / 1000), open, high, low, close, volume });
  }
  return [...new Map(rows.map(c => [c.time, c])).values()].sort((a, b) => a.time - b.time);
}
export function percentageChange(current: number, previous: number) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) throw new Error('Invalid comparison prices.');
  return (current / previous - 1) * 100;
}
export async function marketRequest(path: string, signal: AbortSignal) {
  const response = await fetch(`${MARKET_API}/api/v3/${path}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]), referrerPolicy: 'no-referrer', credentials: 'omit' });
  if (!response.ok) throw new Error(response.status === 451 || response.status === 403 ? 'Market data is unavailable in this region.' : response.status === 429 ? 'Market provider rate limit reached. Retrying shortly.' : 'Market provider is unavailable.');
  return response.json();
}
