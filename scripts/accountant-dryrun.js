// The Accountant's dry run: runs the real INTAKE against a mocked ledger (no Notion, never Jake's real tree) for the
// made-up profiles in server/accountant-grade.js, then grades every planted strategy.
//   node scripts/accountant-dryrun.js [builder|chef|creator ...]
// Results go to data/accountant-dryrun/<profile>.json (git-ignored). Uses real model calls (Opus intake).
import fs from 'node:fs';
import path from 'node:path';
import { runAccountant } from '../server/accountant.js';
import { DRY_PROFILES, mockLedger, gradeTree, intakeText } from '../server/accountant-grade.js';

const OUT = path.join(process.cwd(), 'data', 'accountant-dryrun');
fs.mkdirSync(OUT, { recursive: true });
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(DRY_PROFILES);

await Promise.all(names.map(async (name) => {
  const profile = DRY_PROFILES[name];
  if (!profile) { console.error(`no profile ${name}`); return; }
  const { fetcher, strategies } = mockLedger(profile);
  const t0 = Date.now();
  let answer = '', changes = [], error = null;
  try { ({ answer, changes } = await runAccountant({ kind: 'Intake', question: intakeText(profile) }, profile, { fetcher })); }
  catch (e) { error = e.message; }
  const grade = gradeTree(strategies, { answer });
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ name, seconds: Math.round((Date.now() - t0) / 1000), error, answer, changes, grade, strategies }, null, 2));
  console.log(`${name}: ${strategies.length} planted, ${grade.pass ? 'PASS' : 'FAIL'}${error ? ' (error: ' + error + ')' : ''}`);
  for (const c of grade.checks) console.log(`  ${c.ok ? 'ok ' : 'NO '} ${c.what}`);
  for (const f of grade.flagged) console.log(`  flagged: ${f.name}: ${f.problems.join('; ')}`);
}));
