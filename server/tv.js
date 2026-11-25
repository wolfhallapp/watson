// The house TV (Horace 11/23): this PC drives the TV over its second HDMI, and the TV is seen from across the house,
// so it shows only what's fine for anyone who walks by: no money, no bills, no Pool, nothing private.
// GET /tv/state gathers it in one call; each source is cached, and a source that fails just leaves its panel out.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DATA_DIR } from './config.js';
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
const PRIVATE_LINE = /\$|bill|pool|budget|spend|balance|pay(ments?|days?|check)?\b|money|debt|credit|loan|gambl|casino|botanical|health|med(s|ication)?\b|gift/i;
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

// Short ESV verses (Horace reads the ESV). 11/24 (Horace: "more verses"): three a day on the TV, morning to night.
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
  ['John 3:16', 'For God so loved the world, that he gave his only Son, that whoever believes in him should not perish but have eternal life.'],
  ['Psalm 23:1', 'The LORD is my shepherd; I shall not want.'],
  ['Romans 8:28', 'And we know that for those who love God all things work together for good, for those who are called according to his purpose.'],
  ['Jeremiah 29:11', 'For I know the plans I have for you, declares the LORD, plans for welfare and not for evil, to give you a future and a hope.'],
  ['Matthew 11:28', 'Come to me, all who labor and are heavy laden, and I will give you rest.'],
  ['Psalm 119:105', 'Your word is a lamp to my feet and a light to my path.'],
  ['Proverbs 17:17', 'A friend loves at all times, and a brother is born for adversity.'],
  ['Romans 12:12', 'Rejoice in hope, be patient in tribulation, be constant in prayer.'],
  ['1 John 4:19', 'We love because he first loved us.'],
  ['Galatians 6:9', 'And let us not grow weary of doing good, for in due season we will reap, if we do not give up.'],
  ['Psalm 34:8', 'Oh, taste and see that the LORD is good! Blessed is the man who takes refuge in him!'],
  ['Micah 6:8', 'He has told you, O man, what is good; and what does the LORD require of you but to do justice, and to love kindness, and to walk humbly with your God?'],
  ['Hebrews 13:8', 'Jesus Christ is the same yesterday and today and forever.'],
  ['Isaiah 41:10', 'Fear not, for I am with you; be not dismayed, for I am your God; I will strengthen you, I will help you, I will uphold you with my righteous right hand.'],
  ['Psalm 37:4', 'Delight yourself in the LORD, and he will give you the desires of your heart.'],
  ['Matthew 5:16', 'In the same way, let your light shine before others, so that they may see your good works and give glory to your Father who is in heaven.'],
  ['Proverbs 16:3', 'Commit your work to the LORD, and your plans will be established.'],
  ['Lamentations 3:22-23', 'The steadfast love of the LORD never ceases; his mercies never come to an end; they are new every morning; great is your faithfulness.'],
  ['2 Corinthians 5:17', 'Therefore, if anyone is in Christ, he is a new creation. The old has passed away; behold, the new has come.'],
  ['Philippians 4:6', 'Do not be anxious about anything, but in everything by prayer and supplication with thanksgiving let your requests be made known to God.'],
  ['James 1:19', 'Know this, my beloved brothers: let every person be quick to hear, slow to speak, slow to anger.'],
  ['Psalm 121:1-2', 'I lift up my eyes to the hills. From where does my help come? My help comes from the LORD, who made heaven and earth.'],
  ['Proverbs 22:6', 'Train up a child in the way he should go; even when he is old he will not depart from it.'],
  ['1 Corinthians 13:4', 'Love is patient and kind; love does not envy or boast; it is not arrogant.'],
  ['Romans 15:13', 'May the God of hope fill you with all joy and peace in believing, so that by the power of the Holy Spirit you may abound in hope.'],
  ['Psalm 28:7', 'The LORD is my strength and my shield; in him my heart trusts, and I am helped.'],
  ['Joshua 1:9', 'Be strong and courageous. Do not be frightened, and do not be dismayed, for the LORD your God is with you wherever you go.'],
  ['Matthew 6:33', 'But seek first the kingdom of God and his righteousness, and all these things will be added to you.'],
  ['Psalm 100:4', 'Enter his gates with thanksgiving, and his courts with praise! Give thanks to him; bless his name!'],
  ['Colossians 3:14', 'And above all these put on love, which binds everything together in perfect harmony.'],
  ['Nehemiah 8:10', 'Do not be grieved, for the joy of the LORD is your strength.'],
  ['Psalm 107:1', 'Oh give thanks to the LORD, for he is good, for his steadfast love endures forever!'],
  ['John 14:27', 'Peace I leave with you; my peace I give to you. Not as the world gives do I give to you. Let not your hearts be troubled, neither let them be afraid.'],
  ['Proverbs 15:1', 'A soft answer turns away wrath, but a harsh word stirs up anger.'],
  ['Zephaniah 3:17', 'The LORD your God is in your midst, a mighty one who will save; he will rejoice over you with gladness.'],
];
export function verseOfDay(now = new Date()) {
  const day = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000);
  const [ref, text] = VERSES[day % VERSES.length];
  return { ref, text };
}
/** Three different verses for today (17 apart in the list, so neighbouring days don't repeat). */
export function versesOfDay(now = new Date(), n = 3) {
  const day = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000);
  return Array.from({ length: n }, (_, i) => { const [ref, text] = VERSES[(day * n + i * 17) % VERSES.length]; return { ref, text }; });
}

// "Did you know?" (11/24, Horace: "more informative data"): kid-friendly, family-safe facts, a few a day.
export const FACTS = [
  'Texas is so big that El Paso is closer to San Diego than it is to Beaumont.',
  'The Texas state tree is the pecan, and Texas grows more pecans than almost any other state.',
  'A bolt of lightning is about five times hotter than the surface of the sun.',
  'Honey never spoils: archaeologists have found honey in ancient Egyptian tombs that was still good to eat.',
  'Octopuses have three hearts and blue blood.',
  'Bluebonnets, the Texas state flower, bloom from March to May.',
  'The Moon moves about 1.5 inches farther from Earth every year.',
  'A group of flamingos is called a flamboyance.',
  'Your heart beats about 100,000 times a day.',
  'Dogs can smell about 10,000 to 100,000 times better than people.',
  'Cats spend about two thirds of their lives asleep.',
  'The Lone Star flag is the only US state flag that once flew over an independent nation.',
  'Sound travels about four times faster in water than in air.',
  'A single cloud can weigh more than a million pounds.',
  'Bananas are berries, but strawberries are not.',
  'The Eiffel Tower can grow about six inches taller in summer heat.',
  'Armadillos can hold their breath for about six minutes.',
  'The longest river in Texas wholly inside the state is the Brazos.',
  'Sea otters hold hands while they sleep so they do not drift apart.',
  'There are more trees on Earth than stars in the Milky Way.',
  'A day on Venus is longer than a year on Venus.',
  'The first cup of coffee in Texas likely arrived with Spanish missions in the 1700s.',
  'Hummingbirds are the only birds that can fly backwards.',
  'An adult has 206 bones; a newborn baby has about 300 that fuse as they grow.',
  'The Gutenberg Bible, printed around 1455, was one of the first books printed with movable type in Europe.',
  'The Bible has been translated, in whole or in part, into more than 3,000 languages.',
  'Pickup trucks have been the best-selling vehicles in America for over 40 years.',
  'Chess has more possible games than there are atoms in the observable universe.',
  'A barbecue brisket can smoke for 12 hours or more.',
  'The Dallas Cowboys have won five Super Bowls.',
];
export function factsOfDay(now = new Date(), n = 3) {
  const day = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000);
  return Array.from({ length: n }, (_, i) => FACTS[(day * n + i * 11) % FACTS.length]);
}

// Sunrise and sunset (NOAA's simple formula) for central Texas: Austin's public city center, never the house.
const SUN_AT = { lat: 30.27, lon: -97.74 };
export function sunTimes(now = new Date(), { lat, lon } = SUN_AT) {
  const rad = Math.PI / 180, day = Math.floor((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(now.getFullYear(), 0, 0)) / 86400000);
  const g = 2 * Math.PI / 365 * (day - 1);
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const ha = Math.acos(Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl)) - Math.tan(lat * rad) * Math.tan(decl)) / rad;
  const utcMin = (sign) => 720 - 4 * (lon + sign * ha) - eq; // minutes after UTC midnight
  const at = (m) => new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) + m * 60000);
  const fmt = (d) => d.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' });
  const rise = at(utcMin(1)), set = at(utcMin(-1)), mins = Math.round((set - rise) / 60000);
  return { sunrise: fmt(rise), sunset: fmt(set), daylight: `${Math.floor(mins / 60)}h ${mins % 60}m` };
}
/** The Moon's phase from a known new moon (Jan 6, 2000 18:14 UTC). */
export function moonPhase(now = new Date()) {
  const age = (((now - Date.UTC(2000, 0, 6, 18, 14)) / 86400000) % 29.530588853 + 29.530588853) % 29.530588853;
  const names = [['🌑', 'New moon'], ['🌒', 'Waxing crescent'], ['🌓', 'First quarter'], ['🌔', 'Waxing gibbous'], ['🌕', 'Full moon'], ['🌖', 'Waning gibbous'], ['🌗', 'Last quarter'], ['🌘', 'Waning crescent']];
  const [icon, name] = names[Math.floor((age / 29.530588853) * 8 + 0.5) % 8];
  const toFull = Math.round(((14.765 - age) + 29.530588853) % 29.530588853);
  return { icon, name, toFull: name === 'Full moon' || toFull === 0 || toFull >= 29 ? 'Tonight' : toFull === 1 ? '1 day' : `${toFull} days` };
}

/** The next forecast periods (NWS) for the forecast card: name, temp, short text, rain chance. */
export function forecastCard(periods = [], alerts = [], n = 6) {
  const out = (periods || []).slice(0, n).filter((p) => Number.isFinite(Number(p?.temperature)))
    .map((p) => ({ name: p.name, temp: p.temperature, text: p.shortForecast, rain: Number(p?.probabilityOfPrecipitation?.value) || 0, day: !!p.isDaytime }));
  return out.length ? { periods: out, alerts: [...new Set((alerts || []).map((a) => String(a?.event || '').trim()).filter(Boolean))].slice(0, 3) } : null;
}

/** School for the girls (Jarrell ISD calendar): today, when they're back, the next days off. No attendance, ever. */
export function schoolCard(s, now = new Date()) {
  if (!s?.ok || s.yearOver) return null;
  const label = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const today = s.day?.school ? 'School today' : `No school today${s.day?.why && !/weekend|summer/.test(s.day.why) ? ` (${s.day.why})` : ''}`;
  return { today, back: s.back ? `Back to school ${label(s.back)}` : null,
    upcoming: (s.upcoming || []).filter((u) => u && (u.title || u.label)).slice(0, 3).map((u) => `${u.when || u.range || label(u.from || u.date)}: ${u.title || u.label}`) };
}

// NASA's Astronomy Picture of the Day (free; DEMO_KEY is fine at one call a day). Images only.
export async function spacePicture({ fetchImpl = fetch } = {}) {
  const r = await fetchImpl('https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY', { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('APOD ' + r.status);
  const d = await r.json();
  // Only a real APOD image (the feed sometimes answers with NASA's logo instead).
  if (d.media_type !== 'image' || !/^https:\/\/apod\.nasa\.gov\/apod\/image\//.test(d.url || '') || !d.explanation) throw new Error('no picture today');
  const words = String(d.explanation || '').split(/(?<=\.)\s+/).slice(0, 2).join(' ');
  return { title: d.title, url: d.url, text: words.length > 320 ? words.slice(0, 317) + '...' : words };
}

/** The trip countdown and freeze warnings from /away, with no checklist or addresses. */
export function tripPanel(a) {
  if (!a?.ok || !a.on || a.expired) return null;
  return { phase: a.phase, leave: a.leave, back: a.back, freezes: (a.freezes || []).map((f) => `${f.name}: low ${f.low}°F`).slice(0, 3) };
}

/** The trip's open checklist items (the shared house list), never addresses or money. */
export function tripTodo(a, n = 6) {
  if (!a?.ok || !a.on || a.expired || a.phase !== 'before') return [];
  return (a.checklist || []).filter((c) => !c.done && c.item && !PRIVATE_LINE.test(c.item)).map((c) => c.item.replace(/\s*\(.*$/, '')).slice(0, n);
}

/** "What's new in Wolf Hall": the newest "vNNN deployed: a, b, c" heading in PROGRESS.md, private items dropped. */
export function shippedFrom(progress) {
  const m = String(progress || '').match(/^## \d{4}-\d{2}-\d{2}[^\n]*?\b(v\d+) deployed:\s*([^\n]+)/m);
  if (!m) return null;
  const items = m[2].split(/,\s*|\s+and\s+/).map((s) => s.trim()).filter((s) => s && !PRIVATE_LINE.test(s)).slice(0, 5);
  return items.length ? { version: m[1], items } : null;
}
export const PROGRESS_FILE = path.join(os.homedir(), 'projects', 'wolf-hall-app', 'PROGRESS.md');

// Commercials (Night Shift #122): data/commercials/<name>/<name>.mp4, played on the TV only (never posted).
export const COMMERCIALS_DIR = path.join(DATA_DIR, 'commercials');
export function commercials(dir = COMMERCIALS_DIR) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && /^[a-z0-9-]+$/.test(d.name))
      .filter((d) => fs.existsSync(path.join(dir, d.name, `${d.name}.mp4`))).map((d) => d.name);
  } catch { return []; }
}
/** The mp4 for /tv/media/<name>.mp4, or null. Only names from commercials() are served. */
export function commercialFile(name, dir = COMMERCIALS_DIR) {
  return commercials(dir).includes(name) ? path.join(dir, name, `${name}.mp4`) : null;
}

// The family slides (11/24): only the ones reviewed and listed in data/commercials/tv-slides.json go on the TV
// (Horace: "after review"). Four a load, a different four as the day goes on, so the deck doesn't fill with them.
export const SLIDES_DIR = path.join(COMMERCIALS_DIR, 'slides');
export function approvedSlides(dir = SLIDES_DIR, list = path.join(COMMERCIALS_DIR, 'tv-slides.json')) {
  try {
    const names = JSON.parse(fs.readFileSync(list, 'utf8'));
    return (Array.isArray(names) ? names : []).filter((n) => typeof n === 'string' && /^[a-z0-9-]+$/.test(n) && fs.existsSync(path.join(dir, `${n}.png`)));
  } catch { return []; }
}
export function slidesNow(names, now = new Date(), n = 4) {
  if (!names.length) return [];
  const start = (Math.floor(now.getTime() / (20 * 60000)) * n) % names.length; // a new set every 20 minutes
  return Array.from({ length: Math.min(n, names.length) }, (_, i) => names[(start + i) % names.length]);
}
/** The png for /tv/slide/<name>.png, or null. Only approved names are served. */
export function slideFile(name, dir = SLIDES_DIR, list) {
  return approvedSlides(dir, list).includes(name) ? path.join(dir, `${name}.png`) : null;
}

/** The space picture's bytes, fetched by this PC (the TV page only loads its own images). */
export async function spaceImage({ fetchImpl = fetch } = {}) {
  return cached('space-img', 6 * 3600000, async () => {
    const s = await cached('space', 6 * 3600000, async () => spacePicture());
    if (!s?.url) return null;
    const r = await fetchImpl(s.url, { signal: AbortSignal.timeout(30000) });
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !/^image\/(jpeg|png|gif|webp)$/.test(type)) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.length < 15e6 ? { type, buf } : null;
  });
}

export async function tvState({ get = workerGet, weather = houseWeather, now = new Date(), progress = () => fs.readFileSync(PROGRESS_FILE, 'utf8'), commercialsDir, slidesDir, slidesList } = {}) {
  const [wx, day, away, school, space] = await Promise.all([
    cached('weather', 20 * 60000, async () => await weather()),
    cached('dayahead', 15 * 60000, async () => { const r = await get('/dayahead'); const d = JSON.parse(r.body); return d.ok ? d : null; }),
    cached('away', 15 * 60000, async () => { const r = await get('/away'); return JSON.parse(r.body); }),
    cached('school', 60 * 60000, async () => { const r = await get('/school'); const d = JSON.parse(r.body); return schoolCard(d, now); }),
    cached('space', 6 * 3600000, async () => spacePicture()),
  ]);
  const w = wx?.short;
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
    verses: versesOfDay(now),
    facts: factsOfDay(now),
    forecast: forecastCard(wx?.periods, wx?.alerts),
    sky: { ...sunTimes(now), moon: moonPhase(now) },
    school: school || null,
    space: space || null,
    packing: tripTodo(away),
    shipped: (() => { try { return shippedFrom(progress()); } catch { return null; } })(),
    commercials: commercials(commercialsDir),
    slides: slidesNow(approvedSlides(slidesDir, slidesList), now),
  };
}
