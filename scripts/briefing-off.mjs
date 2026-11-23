// Take Construct strategies off (or back on) Horace's morning briefing, keeping them on the tree (Night Shift #92).
// Usage: node scripts/briefing-off.mjs [--on] [--file path/to/construct.json] <strategy id or name>...
// e.g. node scripts/briefing-off.mjs s009 s010 s013   (Respondent, Prolific, the unclaimed-property search; Horace 11/23)
import { Construct } from '../server/construct.js';

const args = process.argv.slice(2);
const on = args.includes('--on');
const fi = args.indexOf('--file');
const file = fi >= 0 ? args[fi + 1] : undefined;
const refs = args.filter((a, i) => !a.startsWith('--') && !(fi >= 0 && i === fi + 1));
if (!refs.length) { console.error('Name at least one strategy (id like s010, or a loose name like prolific).'); process.exit(2); }
const c = file ? new Construct(file, null) : new Construct();
let bad = 0;
for (const ref of refs) {
  try { const r = c.apply('update', { strategy: ref, fields: { briefing: on } }); console.log(`${on ? 'Back on' : 'Off'} the briefing: ${r.strategy.name}`); }
  catch (e) { bad++; console.error(e.message); }
}
process.exit(bad ? 1 : 0);
