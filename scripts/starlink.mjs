// Reads the Starlink dish (read-only): what the Starlink app shows, plus an optional speed test.
// Usage (Windows or WSL):  node scripts/starlink.mjs [history|test|raw]
//   history (default): outages, latency and whole-house speeds over the last ~15 minutes
//   test:              history plus a 5 MB download test
//   raw:               every field of the dish status message, by protobuf field number
import { describeConnection, dishStatusFields, dishSummary } from '../server/starlink.js';

const mode = process.argv[2] || 'history';
if (mode === 'raw') {
  for (const { field, wire, value } of await dishStatusFields()) console.log(field, wire === 2 ? `<${value.length} bytes>` : value);
} else {
  console.log(JSON.stringify(await dishSummary(), null, 2));
  console.log((await describeConnection({ speedTest: mode === 'test' })).text);
}
