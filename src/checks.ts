export interface Check { name: string; execute: () => Promise<void> }
export function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : '실행 오류').replace(/https?:\/\/\S+/g, '[URL 숨김]');
}
// Sequential checks share one state file safely; failures never short-circuit another provider.
export async function runChecks(checks: Check[], logError: (message: string) => void): Promise<void> {
  const failed: string[] = [];
  for (const check of checks) {
    try { await check.execute(); }
    catch (error) { failed.push(check.name); logError(`[${check.name}] 실패: ${safeError(error)}`); }
  }
  if (failed.length) throw new Error(`검사 실패: ${failed.join(', ')}`);
}
