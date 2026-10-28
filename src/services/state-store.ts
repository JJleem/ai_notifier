import { mkdir, readFile, rename, writeFile, open, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { State } from '../types/reset.js';
import { validDate } from './reset-api.js';
export const emptyState = (): State => ({ version: 1, initializedAt: null, seenIds: [], seenSources: [] });
export async function readState(path: string): Promise<State> {
  let text: string;
  try { text = await readFile(path, 'utf8'); } catch (error) {
    // A missing state must not silently reinitialize an existing deployment.
    throw new Error('상태 파일을 읽을 수 없습니다. 저장소의 state/seen-events.json을 복구하세요.');
  }
  let s: State;
  try { s = JSON.parse(text) as State; } catch { throw new Error('상태 JSON 손상'); }
  if (!s || s.version !== 1 || !(s.initializedAt === null || validDate(s.initializedAt)) ||
      !Array.isArray(s.seenIds) || !s.seenIds.every(x => typeof x === 'string') ||
      !Array.isArray(s.seenSources) || !s.seenSources.every(x => typeof x === 'string') ||
      (s.initializedAt === null && (s.seenIds.length > 0 || s.seenSources.length > 0))) throw new Error('상태 스키마 손상');
  return s;
}
export async function saveState(path: string, state: State): Promise<void> {
  const content = JSON.stringify(state, null, 2) + '\n';
  if (await readFile(path, 'utf8').catch(() => '') === content) return;
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, content, { mode: 0o600 });
  await rename(temp, path);
}
export async function lockState(path: string): Promise<() => Promise<void>> {
  await mkdir(dirname(path), { recursive: true });
  const lock = `${path}.lock`;
  const handle = await open(lock, 'wx').catch(() => { throw new Error('다른 실행 또는 잔여 상태 잠금이 있습니다.'); });
  return async () => { await handle.close(); await unlink(lock); };
}
