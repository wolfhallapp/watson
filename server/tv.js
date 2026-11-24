// The house TV (Horace 11/23): this PC drives the TV over its second HDMI, and the TV is seen from across the house,
// so it shows only what's fine for anyone who walks by: no money, no bills, no Pool, nothing private.
// GET /tv/state gathers it in one call; each source is cached, and a source that fails just leaves its panel out.
import { workerGet } from './knowledge.js';
import { houseWeather } from './weather.js';

const cache = new Map();
async function cached(key, ms, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ms) return hit.v;
  try { const v = await fn(); cache.set(key, { at: Date.now(), v }); return v; }
  catch { return hit ? hit.v : null; }
}

// Lines from the day-ahead that are fine on a shared screen. Money never shows on the TV.
const PRIVATE_LINE = /\$|bill|pool|budget|spend|balance|pay(ment|day)?\b|debt|credit|loan|gambl|casino|botanical|health|med(s|ication)?\b|gift/i;
export function publicLines(lines = []) {
  return lines.filter((l) => l && typeof l.t === 'string' && !/^(bills|money|pool|budget|health|gifts?)$/i.test(l.k || '') && !PRIVATE_LINE.test(l.t))
    .map((l) => l.t).slice(0, 6);
}

// Birthdays and the big days (from Horace 11/23). Month is 1-12.
export const BIG_DAYS = [
  { name: 'Jake\'s birthday', m: 2, d: 7, icon: '🎂' }, { name: 'Tatiyana\'s birthday', m: 3, d: 27, icon: '🎂' },
  { name: 'Taylor\'s birthday', m: 5, d: 3, icon: '🎂' }, { name: 'Kai\'s birthday', m: 6, d: 22, icon: '🎂' },
  { name: 'Katana\'s birthday', m: 8, d: 24, icon: '🎂' }, { name: 'Horace\'s birthday', m: 9, d: 27, icon: '🎂' },
  { name: 'Christmas', m: 12, d: 25, icon: '🎄' }, { name: 'New Year\'s Day', m: 1, d: 1, icon: '🎆' },
  { name: 'Independence Day', m: 7, d: 4, icon: '🎇' }, { name: 'Halloween', m: 10, d: 31, icon: '🎃' },
];
/** Thanksgiving: the 4th Thursday of November. */
function thanksgiving(y) { const d = new Date(y, 10, 1); const first = (11 - d.getDay()) % 7 + 1; return new Date(y, 10, first + 21); }
export function countdowns(now = new Date(), n = 5) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const next = (m, d) => { let t = new Date(today.getFullYear(), m - 1, d); if (t < today) t = new Date(today.getFullYear() + 1, m - 1, d); return t; };
  const items = BIG_DAYS.map((b) => ({ name: b.name, icon: b.icon, date: next(b.m, b.d) }));
  let tg = thanksgiving(today.getFullYear()); if (tg < today) tg = thanksgiving(today.getFullYear() + 1);
  items.push({ name: 'Thanksgiving', icon: '🦃', date: tg });
  return items.map((i) => ({ name: i.name, icon: i.icon, date: i.date.toISOString().slice(0, 10), days: Math.round((i.date - today) / 86400000) }))
    .sort((a, b) => a.days - b.days).slice(0, n);
}

// The church week (Horace 11/23). day: 0 = Sunday.
export const CHURCH_WEEK = [
  { day: 0, time: '9:30 AM', what: 'Bible study' }, { day: 0, time: '10:30 AM', what: 'Sunday service (leave by 8:30)' },
  { day: 1, time: 'Evening', what: 'Ephesians class' }, { day: 3, time: 'Evening', what: 'Wednesday night service' },
  { day: 4, time: 'Evening', what: 'Bible History' },
];
export function churchNext(now = new Date(), n = 3) {
  const out = [];
  for (let i = 0; i < 7 && out.length < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    for (const c of CHURCH_WEEK) if (c.day === d.getDay() && out.length < n) out.push({ when: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-US', { weekday: 'long' }), time: c.time, what: c.what });
  }
  return out;
}

// A few short ESV verses (Horace reads the ESV), one per day.
export const VERSES = [
  ['Ephesians 2:8', 'For by grace you have been saved through faith. And this is not your own doing; it is the gift of God.'],
  ['Psalm 118:24', 'This is the day that the LORD has made; let us rejoice and be glad in it.'],
  ['Joshua 24:15', 'But as for me and my house, we will serve the LORD.'],
  ['Proverbs 3:5', 'Trust in the LORD with all your heart, and do not lean on your own understanding.'],
  ['Philippians 4:13', 'I can do all things through him who strengthens me.'],
  ['Ephesians 4:32', 'Be kind to one another, tenderhearted, forgiving one another, as God in Christ forgave you.'],
  ['Psalm 46:10', 'Be still, and know that I am God.'],
  ['Colossians 3:23', 'Whatever you do, work heartily, as for the Lord and not for men.'],
  ['1 Thessalonians 5:18', 'Give thanks in all circumstances; for this is the will of God in Christ Jesus for you.'],
  ['Isaiah 40:31', 'But they who wait for the LORD shall renew their strength; they shall mount up with wings like eagles.'],
];
export function verseOfDay(now = new Date()) {
  const day = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000);
  const [ref, text] = VERSES[day % VERSES.length];
  return { ref, text };
}

/** The trip countdown and freeze warnings from /away, with no checklist or addresses. */
export function tripPanel(a) {
  if (!a?.ok || !a.on || a.expired) return null;
  return { phase: a.phase, leave: a.leave, back: a.back, freezes: (a.freezes || []).map((f) => `${f.name}: low ${f.low}°F`).slice(0, 3) };
}

export async function tvState({ get = workerGet, weather = houseWeather, now = new Date() } = {}) {
  const [w, day, away] = await Promise.all([
    cached('weather', 20 * 60000, async () => (await weather()).short),
    cached('dayahead', 15 * 60000, async () => { const r = await get('/dayahead'); const d = JSON.parse(r.body); return d.ok ? d : null; }),
    cached('away', 15 * 60000, async () => { const r = await get('/away'); return JSON.parse(r.body); }),
  ]);
  const weekLines = publicLines(day?.week?.lines).filter((t) => !/^weather/i.test(t));
  return {
    ok: true, at: now.toISOString(),
    weather: w || null,
    week: day?.week?.lines?.find((l) => l.k === 'weather')?.t || null,
    today: publicLines(day?.today?.lines).filter((t) => !/^weather/i.test(t)).filter((t) => !/^care jobs/i.test(t)),
    weekLines,
    trip: tripPanel(away),
    countdowns: countdowns(now),
    church: churchNext(now),
    verse: verseOfDay(now),
  };
}
