// Regenerates samples/teams-sample.xlsx from teams-sample.csv:  npx tsx ../samples/make-xlsx.mts  (run from server/)
import { readFileSync, writeFileSync } from 'node:fs';
import { parseCsv, toXlsx } from '../server/src/services/spreadsheet.js';

const rows = parseCsv(readFileSync(new URL('./teams-sample.csv', import.meta.url), 'utf8')).filter((r) => r.some((c) => c.trim()));
// The XLSX sample uses different (aliased) headers to exercise header aliases.
const header = rows[0].map((h) => (h === 'team_name' ? 'Team Name' : h === 'captain_email' ? 'Captain Email' : h === 'member1_name' ? 'Captain' : h));
const body = rows.slice(1).map((r) => r.map((c) => c));
writeFileSync(new URL('./teams-sample.xlsx', import.meta.url), await toXlsx('teams', header, body));
console.log(`wrote teams-sample.xlsx (${body.length} rows)`);
