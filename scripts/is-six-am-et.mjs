import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Keep the existing entry point, but allow delayed runs once today's scan is due.
export function isSixAmEastern(date, { runsDir = 'data/runs', manual = false } = {}) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(({ type, value }) => [type, value]));
  const runDate = `${parts.year}-${parts.month}-${parts.day}`;
  return (manual || Number(parts.hour) >= 6) && !existsSync(join(runsDir, `${runDate}.json`));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(isSixAmEastern(new Date(), { manual: process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' }) ? 'true' : 'false');
}
