import { setTimeout as sleep } from 'node:timers/promises';
export type Fetch = typeof fetch;
export interface HttpOptions {
  fetcher?: Fetch;
  wait?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}
// Read the body inside the timeout too. Never expose request URLs or response bodies in errors.
export async function request(url: string, init: RequestInit = {}, options: HttpOptions = {}): Promise<string> {
  const fetcher = options.fetcher ?? fetch;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
    let retryAfter = 0;
    let retry = false;
    let failure = 'HTTP 네트워크 오류 또는 타임아웃';
    try {
      const response = await fetcher(url, { ...init, redirect: 'error', signal: controller.signal });
      if (response.ok) return await response.text();
      failure = `HTTP 요청 실패 (${response.status})`;
      retry = response.status === 429 || response.status >= 500;
      const header = response.headers.get('retry-after');
      if (header) retryAfter = /^\d+$/.test(header) ? Number(header) * 1000 : Math.max(0, Date.parse(header) - Date.now());
      await response.body?.cancel();
    } catch {
      retry = true;
    } finally { clearTimeout(timer); }
    if (!retry || attempt === 2 || retryAfter > 60_000) throw new Error(failure);
    await (options.wait ?? sleep)(Math.max(Number.isFinite(retryAfter) ? retryAfter : 0, 1000 * 2 ** attempt) + Math.floor(Math.random() * 250));
  }
  throw new Error('HTTP 요청 실패');
}
