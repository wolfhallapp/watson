// Lists night branches (both repos) that still have work main doesn't. Read-only.
// Usage: node scripts/night-pending.mjs [--line]
import { findPendingNightWork, formatPending, nightPendingLine } from '../server/night-pending.js';

const found = findPendingNightWork();
console.log(process.argv.includes('--line') ? (nightPendingLine(found) || 'Nothing waiting.') : formatPending(found));
