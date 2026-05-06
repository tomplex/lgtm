import type { AnalysisFreshness, ConnectionState } from './state';
import { baseUrl } from './api';

/** Returns null on 404 (no analysis set). Throws on other errors. */
export async function fetchFreshness(): Promise<AnalysisFreshness | null> {
  const res = await fetch(`${baseUrl()}/analysis/freshness`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fetchFreshness: ${res.status}`);
  return res.json();
}

export async function fetchConnectionState(): Promise<ConnectionState> {
  const res = await fetch(`${baseUrl()}/connection-state`);
  if (!res.ok) throw new Error(`fetchConnectionState: ${res.status}`);
  return res.json();
}

export async function postRefreshAnalysis(): Promise<{ delivered: boolean; reason?: string }> {
  const res = await fetch(`${baseUrl()}/refresh-analysis`, { method: 'POST' });
  return res.json();
}
