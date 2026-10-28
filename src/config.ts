export interface Config {
  apiUrl: string;
  webhookUrl?: string;
  dryRun: boolean;
  allowProvisional: boolean;
  allowUpstream: boolean;
}
function bool(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  if (value !== 'true' && value !== 'false') throw new Error('Boolean 환경변수는 true/false만 허용합니다.');
  return value === 'true';
}
export function config(env: NodeJS.ProcessEnv = process.env): Config {
  const dryRun = bool(env.DRY_RUN);
  const apiUrl = env.RESET_API_URL ?? 'https://claude-resets.com/api/resets';
  let api: URL;
  try { api = new URL(apiUrl); } catch { throw new Error('RESET_API_URL 형식 오류'); }
  if (api.protocol !== 'https:' || api.username || api.password || api.hash) throw new Error('RESET_API_URL은 인증정보 없는 HTTPS URL이어야 합니다.');
  const webhookUrl = env.SLACK_WEBHOOK_URL || undefined;
  if (webhookUrl) {
    let u: URL;
    try { u = new URL(webhookUrl); } catch { throw new Error('SLACK_WEBHOOK_URL 형식 오류'); }
    if (u.protocol !== 'https:' || !['hooks.slack.com', 'hooks.slack-gov.com'].includes(u.hostname) || u.port || u.username || u.password || u.search || u.hash || !/^\/services\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(u.pathname)) throw new Error('SLACK_WEBHOOK_URL 형식 오류');
  } else if (!dryRun) throw new Error('SLACK_WEBHOOK_URL이 필요합니다.');
  return { apiUrl, ...(webhookUrl ? { webhookUrl } : {}), dryRun, allowProvisional: bool(env.ALLOW_PROVISIONAL_EVENTS), allowUpstream: bool(env.ALLOW_UPSTREAM_EVENTS) };
}
