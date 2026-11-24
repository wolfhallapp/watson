// One voice-over line in a designed voice (the Oracle, Trinity, Pappy, the Workshop Oracle), free and local.
//   node scripts/commercials/say.mjs <voice-id> <out.wav> "text"
import fs from 'node:fs';
import { synthesizeDesigned } from '../../server/tts.js';

const [id, out, ...words] = process.argv.slice(2);
const r = await synthesizeDesigned(words.join(' '), id, 1);
if (!r.ok) { console.error(r.error); process.exit(1); }
fs.writeFileSync(out, r.audio);
console.log('ok', out, r.audio.length);
process.exit(0);
