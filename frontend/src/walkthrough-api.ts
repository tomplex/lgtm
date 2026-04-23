import { baseUrl } from './api';
import type { WalkthroughResponse } from './walkthrough-types';

export async function fetchWalkthrough(): Promise<WalkthroughResponse> {
  const res = await fetch(`${baseUrl()}/walkthrough`);
  if (!res.ok) throw new Error(`fetchWalkthrough ${res.status}`);
  return res.json();
}
