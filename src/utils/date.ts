export function kst(value: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  const get = (name: string) => parts.find(p => p.type === name)!.value;
  return `${get('year')}.${get('month')}.${get('day')} ${get('hour')}:${get('minute')} KST`;
}
export function remaining(value: string, now: Date): string {
  const minutes = Math.ceil((Date.parse(value) - now.getTime()) / 60_000);
  return minutes <= 0 ? '기한 만료' : `${Math.floor(minutes / 1440)}일 ${Math.floor(minutes % 1440 / 60)}시간 ${minutes % 60}분`;
}
