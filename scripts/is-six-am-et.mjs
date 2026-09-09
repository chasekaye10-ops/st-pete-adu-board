import { pathToFileURL } from 'node:url';
export function isSixAmEastern(date) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' }).format(date) === '06';
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(isSixAmEastern(new Date()) ? 'true' : 'false');
