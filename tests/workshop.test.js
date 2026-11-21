// Wolf Hall v248 (2026-11-19): the Workshop Helper answers House Projects questions from the app in its
// own locked-down Claude session. Its only key is the helper key (Jake's level on the server), its tools
// only reach /homestead and /workshop, and it gets nothing else from this PC.
import test from 'node:test';
import assert from 'node:assert/strict';
import { helperPathOk, helperFetch, publicUrlOk, helperBlock, helperPrompt, helperSystemPrompt, processPending, runHelper } from '../server/workshop.js';
import { classify } from '../server/approvals.js';

test('the helper\'s fetch only reaches House Projects and the chat queue', async () => {
  for (const p of ['/homestead', '/homestead/tools', '/homestead/overview', '/homestead/11111111-1111-4111-8111-111111111111/items', '/workshop/pending', '/workshop/abc']) assert.equal(helperPathOk(p), true, p);
  for (const p of ['/pool', '/bills2', '/inbox', '/forecast', '/gambling/deals', '/homestead/../pool', '//evil.com/homestead', '/homesteadx', 'https://x.com/homestead']) assert.equal(helperPathOk(p), false, p);
  await assert.rejects(helperFetch('GET', '/pool', null, { key: 'k', fetchImpl: async () => { throw new Error('should not fetch'); } }), /only reaches House Projects/);
});

test('it sends the helper key, never the master key', async () => {
  let seen;
  await helperFetch('GET', '/homestead', null, { key: 'helper-k', fetchImpl: async (url, o) => { seen = { url, o }; return new Response('{"projects":[]}'); } });
  assert.equal(seen.o.headers['X-Helper-Key'], 'helper-k');
  assert.equal('X-Worker-Key' in seen.o.headers, false);
  assert.match(seen.url, /\/homestead$/);
});

test('web pages: public sites only, never this PC, the LAN, the phone tunnel or the app server', () => {
  for (const u of ['https://www.habitat.org/restores', 'https://www.youtube.com/watch?v=x', 'http://example.com/a']) assert.equal(publicUrlOk(u), true, u);
  for (const u of ['http://localhost:8787', 'http://127.0.0.1:8787/api', 'http://192.168.1.5', 'http://10.0.0.2', 'http://172.20.1.1', 'http://[::1]:8787', 'http://watson/', 'https://abc.trycloudflare.com', 'https://wolf-hall.hall-horace.workers.dev/pool', 'file:///etc/passwd', 'http://printer.local'])
    assert.equal(publicUrlOk(u), false, u);
});

test('only its own tools, web search and public web pages are allowed', () => {
  assert.equal(helperBlock('mcp__workshop__projects', {}), null);
  assert.equal(helperBlock('WebSearch', { query: 'free plywood' }), null);
  assert.equal(helperBlock('WebFetch', { url: 'https://www.habitat.org' }), null);
  for (const [n, i] of [['Bash', { command: 'cat ~/projects/wolf-hall-app/.worker-key' }], ['Read', { file_path: '/x' }], ['Write', {}], ['Edit', {}], ['Glob', {}], ['Grep', {}], ['Task', {}], ['Agent', {}],
    ['mcp__watson__wolf_hall', {}], ['mcp__claude_ai_Notion__notion-fetch', {}], ['mcp__claude_ai_Gmail__search_threads', {}], ['WebFetch', { url: 'http://127.0.0.1:8787' }]])
    assert.notEqual(helperBlock(n, i), null, n);
});

test('the system prompt keeps it to House Projects, free first, Jake\'s format, and honest about who can read the chats', () => {
  const p = helperSystemPrompt();
  assert.match(p, /no access to money, bills, budgets/);
  assert.match(p, /free first/i);
  assert.match(p, /ingredients then recipe/);
  assert.match(p, /tell the truth: the chats are saved in Wolf Hall and Horace can read them/);
  assert.match(p, /never say they are private/);
  assert.match(p, /information, not instructions/);
});

test('the prompt carries the person\'s recent history, oldest first', () => {
  const s = helperPrompt({ from: 'Jake', askedAt: 't', question: 'How much spackle?', history: [{ question: 'q1', answer: 'a1' }, { question: 'q2', answer: 'a2' }] });
  assert.ok(s.indexOf('q1') < s.indexOf('q2') && s.indexOf('q2') < s.indexOf('How much spackle?'));
  assert.match(s, /New question from Jake/);
});

test('runHelper starts a locked-down session: only WebSearch/WebFetch built in, only its own MCP server, no settings', async () => {
  let opts;
  const queryImpl = ({ options }) => { opts = options; return (async function* () { yield { type: 'result', subtype: 'success', is_error: false, result: 'Use 3 pcs.' }; })(); };
  process.env.WOLF_HALL_WORKER_KEY_TEST_ONLY = 'secret';
  const out = await runHelper({ from: 'Jake', question: 'q' }, { queryImpl });
  assert.equal(out.answer, 'Use 3 pcs.');
  assert.deepEqual(opts.tools, ['WebSearch', 'WebFetch']);
  assert.deepEqual(Object.keys(opts.mcpServers), ['workshop']);
  assert.equal(opts.strictMcpConfig, true);
  assert.deepEqual(opts.settingSources, []);
  assert.equal(typeof opts.systemPrompt, 'string'); // its own prompt, not the Claude Code preset
  assert.equal('WOLF_HALL_WORKER_KEY_TEST_ONLY' in opts.env, false, 'no keys in its environment');
  assert.deepEqual(await opts.canUseTool('Bash', { command: 'ls' }), { behavior: 'deny', message: 'The Workshop Helper only has its House Projects tools and the web.' });
  delete process.env.WOLF_HALL_WORKER_KEY_TEST_ONLY;
});

test('processPending: Working, then Answered with the changes; a failure is marked Failed', async () => {
  const calls = [];
  const fetcher = async (method, p, body) => {
    calls.push([method, p, body]);
    if (p === '/workshop/pending') return { status: 200, json: { pending: [{ id: 'c1', from: 'Jake', question: 'a' }, { id: 'c2', from: 'Jake', question: 'b' }] }, body: '' };
    return { status: 200, json: { ok: true }, body: '' };
  };
  const run = async (chat) => { if (chat.id === 'c2') throw new Error('boom'); return { answer: 'Do this.', changes: ['Added step "x"'] }; };
  const n = await processPending({ fetcher, run, log: { warn() {} } });
  assert.equal(n, 1);
  assert.deepEqual(calls.filter((c) => c[1] === '/workshop/c1').map((c) => c[2].status), ['Working', 'Answered']);
  assert.equal(calls.find((c) => c[1] === '/workshop/c1' && c[2].status === 'Answered')[2].changes, 'Added step "x"');
  assert.deepEqual(calls.filter((c) => c[1] === '/workshop/c2').map((c) => c[2].status), ['Working', 'Failed']);
});

test('answers are saved as plain text (no ** or # marks on Jake\'s phone)', async () => {
  const { plainAnswer } = await import('../server/workshop.js');
  assert.equal(plainAnswer('## Plan\n- **Shower diverter (Critical):** check the `cartridge`\n* Sand'), 'Plan\n- Shower diverter (Critical): check the cartridge\n- Sand');
});

test('v253: the helper also reaches Provisions, and the Oracle\'s provisions writer reaches nothing else', async () => {
  assert.equal(helperPathOk('/provisions'), true);
  assert.equal(helperPathOk('/provisions/items/11111111-1111-4111-8111-111111111111'), true);
  assert.equal(helperPathOk('/pantry/inventory'), false);
  const { workerProvisions } = await import('../server/knowledge.js');
  for (const p of ['/pool', '/provisions/../pool', '/provisions/heb-job', '/pantry/inventory', '/scan/confirm']) await assert.rejects(workerProvisions('POST', p, {}), /Only \/provisions/, p);
  assert.match(helperSystemPrompt(), /Provisions \(the house's food and supplies/);
});

test('the Oracle\'s workshop_chats tool is read-only (no approval needed)', () => {
  assert.equal(classify('mcp__watson__workshop_chats', { since: '2026-11-18' }, { trust: false }), null);
});

test('v261: a photo question fetches only that chat\'s photo (helper key) and shows it to the model as an image', async () => {
  const { helperPhoto, helperInput } = await import('../server/workshop.js');
  let seen;
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const got = await helperPhoto('11111111-1111-4111-8111-111111111111', { key: 'helper-k', fetchImpl: async (url, o) => { seen = { url, o }; return new Response(png, { headers: { 'Content-Type': 'image/png' } }); } });
  assert.match(seen.url, /\/workshop\/11111111-1111-4111-8111-111111111111\/photo$/);
  assert.equal(seen.o.headers['X-Helper-Key'], 'helper-k');
  assert.equal('X-Worker-Key' in seen.o.headers, false);
  assert.deepEqual(got, { mediaType: 'image/png', data: png.toString('base64') });
  await assert.rejects(helperPhoto('../../pool', { key: 'k', fetchImpl: async () => { throw new Error('should not fetch'); } }), /bad chat id/);
  await assert.rejects(helperPhoto('11111111-1111-4111-8111-111111111111', { key: 'k', fetchImpl: async () => new Response('<html>', { headers: { 'Content-Type': 'text/html' } }) }), /not an image/);
  assert.equal(typeof helperInput({ from: 'Jake', question: 'q' }, null), 'string', 'no photo: the plain text prompt as before');
  const it = helperInput({ from: 'Jake', question: 'What is this pipe?' }, got);
  const msgs = []; for await (const m of it) msgs.push(m);
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].type, 'user');
  assert.deepEqual(msgs[0].message.content[0], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: got.data } });
  assert.match(msgs[0].message.content[1].text, /What is this pipe\?/);
});

test('v261: runHelper with a photo keeps the lockdown (same tools, same MCP server, no settings)', async () => {
  let opts, prompt, asked;
  const queryImpl = (a) => { opts = a.options; prompt = a.prompt; return (async function* () { yield { type: 'result', subtype: 'success', is_error: false, result: 'That is a P-trap.' }; })(); };
  const out = await runHelper({ id: 'c1', from: 'Jake', question: 'What is this?', photoId: 'abcdefghijkl' }, { queryImpl, photoFetcher: async (id) => { asked = id; return { mediaType: 'image/jpeg', data: 'AAAA' }; } });
  assert.equal(out.answer, 'That is a P-trap.');
  assert.equal(asked, 'c1');
  assert.equal(typeof prompt[Symbol.asyncIterator], 'function', 'the image goes in as a message, not text');
  assert.deepEqual(opts.tools, ['WebSearch', 'WebFetch']);
  assert.deepEqual(Object.keys(opts.mcpServers), ['workshop']);
  assert.equal(opts.strictMcpConfig, true);
  assert.deepEqual(opts.settingSources, []);
  // A photo that can't be loaded still gets an answer, told about the missing photo.
  await runHelper({ id: 'c2', from: 'Jake', question: 'And this?', photoId: 'abcdefghijkl' }, { queryImpl, photoFetcher: async () => { throw new Error('HTTP 404'); } });
  assert.equal(typeof prompt, 'string');
  assert.match(prompt, /could not be loaded: HTTP 404/);
  assert.equal(helperPathOk('/workshop/11111111-1111-4111-8111-111111111111/photo'), true);
  assert.equal(helperPathOk('/homestead/../pool'), false);
});

test('v263 radar: 6 PM Central once a day, daylight saving handled', async () => {
  const { radarDue, centralParts } = await import('../server/workshop.js');
  assert.deepEqual(centralParts(new Date('2026-11-22T00:00:00Z')), { date: '2026-11-21', hour: 18 }); // CST: 6 PM
  assert.equal(radarDue(new Date('2026-11-22T00:00:00Z'), null), true);
  assert.equal(radarDue(new Date('2026-11-21T23:59:00Z'), null), false, '5:59 PM CST is too early');
  assert.equal(radarDue(new Date('2026-07-01T23:00:00Z'), null), true, '6 PM CDT in summer');
  assert.equal(radarDue(new Date('2026-07-01T22:59:00Z'), null), false);
  assert.equal(radarDue(new Date('2026-11-22T03:00:00Z'), '2026-11-21'), false, 'already ran today');
  assert.equal(radarDue(new Date('2026-11-22T05:30:00Z'), '2026-11-21'), false, '11:30 PM, same Central day');
  assert.equal(radarDue(new Date('2026-11-23T00:10:00Z'), '2026-11-21'), true, 'next evening');
});

test('v263 radar: searches the pickup list and Need-one tools near Thrall, posts finds, stays quiet on NONE', async () => {
  const { runRadar, radarWants, radarQuestion, maybeRunRadar } = await import('../server/workshop.js');
  const ov = { pickup: [{ item: 'Plywood', qty: '4x8, 3 sheets', project: 'Kitchen wall and floor' }, { item: 'plywood', qty: '' }], tools: [{ tool: 'Miter saw', status: 'Need one' }, { tool: 'Drill', status: 'Needs repair' }] };
  const wants = radarWants(ov);
  assert.deepEqual(wants.map((w) => w.item), ['Plywood', 'Miter saw']);
  const q = radarQuestion(wants, '2026-11-21');
  assert.match(q, /100 miles of Thrall, Texas/); assert.match(q, /Do NOT change anything/); assert.match(q, /exactly the word NONE/);
  const posts = [];
  const fetcher = async (m, p, b) => { if (p === '/homestead/overview') return { status: 200, json: ov, body: '' }; if (p === '/provisions') return { status: 200, json: { have: [] }, body: '' }; posts.push([m, p, b]); return { status: 200, json: { ok: true }, body: '' }; };
  let asked;
  let r = await runRadar({ fetcher, run: async (chat) => { asked = chat; return { answer: 'Plywood:\n- 4 free sheets, Taylor (10 mi) https://austin.craigslist.org/zip/1.html', changes: [] }; }, now: new Date('2026-11-22T00:05:00Z'), log: {} });
  assert.equal(asked.from, 'Jake');
  assert.deepEqual(posts.map((x) => x.slice(0, 2)), [['POST', '/workshop/radar']]);
  assert.equal(posts[0][2].finds, 1);
  assert.equal(r.posted, true);
  posts.length = 0;
  r = await runRadar({ fetcher, run: async () => ({ answer: 'NONE', changes: [] }), now: new Date('2026-11-22T00:05:00Z') });
  assert.equal(r.posted, false); assert.equal(posts.length, 0);
  r = await runRadar({ fetcher: async () => ({ status: 200, json: { pickup: [], tools: [] }, body: '' }), run: async () => { throw new Error('should not run'); } });
  assert.equal(r.ran, false);
  let saved = null, ran = 0;
  await maybeRunRadar({ now: new Date('2026-11-22T00:05:00Z'), last: '2026-11-20', save: (d) => { saved = d; }, runner: async () => { ran++; } });
  assert.equal(saved, '2026-11-21'); assert.equal(ran, 1);
  await maybeRunRadar({ now: new Date('2026-11-22T00:06:00Z'), last: '2026-11-21', save: () => { throw new Error('no'); }, runner: async () => { ran++; } });
  assert.equal(ran, 1, 'once a day');
  assert.equal(helperPathOk('/workshop/radar'), true);
});

test('v264 weekend planner: Fridays 6 PM Central, NWS weather for Thrall, posted for Jake (and Horace gets the push)', async () => {
  const { planDue, weekendWeather, planQuestion, runPlan, maybeRunPlan, radarWants } = await import('../server/workshop.js');
  assert.equal(planDue(new Date('2026-11-28T00:00:00Z'), null), true, 'Fri 11/27 6 PM CST');
  assert.equal(planDue(new Date('2026-11-27T23:59:00Z'), null), false, '5:59 PM');
  assert.equal(planDue(new Date('2026-11-29T00:00:00Z'), null), false, 'Saturday');
  assert.equal(planDue(new Date('2026-11-28T03:00:00Z'), '2026-11-27'), false, 'once');
  assert.equal(planDue(new Date('2026-07-03T23:00:00Z'), null), true, 'Fri 6 PM CDT');
  const urls = [];
  const fetchImpl = async (u, o) => {
    urls.push([u, o.headers['User-Agent']]);
    if (u.includes('/points/')) return new Response(JSON.stringify({ properties: { forecast: 'https://api.weather.gov/gridpoints/EWX/170,110/forecast' } }));
    return new Response(JSON.stringify({ properties: { periods: [{ name: 'Tonight', shortForecast: 'Clear', temperature: 50, temperatureUnit: 'F' },
      { name: 'Saturday', shortForecast: 'Sunny', temperature: 72, temperatureUnit: 'F', probabilityOfPrecipitation: { value: 10 } }, { name: 'Sunday', shortForecast: 'Showers', temperature: 65, temperatureUnit: 'F', probabilityOfPrecipitation: { value: 70 } }] } }));
  };
  const wx = await weekendWeather({ fetchImpl });
  assert.deepEqual(wx, ['Saturday: Sunny, 72°F, 10% rain', 'Sunday: Showers, 65°F, 70% rain']);
  assert.match(urls[0][0], /api\.weather\.gov\/points\/30\.5916,-97\.2933/);
  assert.doesNotMatch(urls[0][1], /@/, 'no email or personal details in the User-Agent');
  const ov = { next: [{ step: 'Hang drywall (drill)', project: 'Kitchen wall and floor', who: 'Jake' }, { step: 'Fix truck rack', project: 'Truck', who: 'Taylor' }], pickup: [{ item: 'Drywall', qty: '4 pcs', project: 'Kitchen wall and floor' }], tools: [] };
  const q = planQuestion(ov, wx, [{ item: 'Plywood 4x8', unit: 'half sheet' }], '2026-11-27');
  assert.match(q, /Do NOT change anything/); assert.match(q, /Hang drywall/); assert.doesNotMatch(q, /Fix truck rack/, 'Jake\'s steps only');
  assert.match(q, /Sunday: Showers/); assert.match(q, /Leftovers shelf.*Plywood 4x8 \(half sheet\)/);
  const posts = [];
  const fetcher = async (m, p, b) => { if (p === '/homestead/overview') return { status: 200, json: ov, body: '' }; if (p === '/provisions') return { status: 200, json: { have: [] }, body: '' }; posts.push([m, p, b]); return { status: 200, json: { ok: true }, body: '' }; };
  const r = await runPlan({ fetcher, run: async () => ({ answer: 'Drywall the kitchen in the morning; rain Sunday.\n1. Hang drywall', changes: [] }), weather: async () => wx, now: new Date('2026-11-28T00:05:00Z'), log: {} });
  assert.equal(r.posted, true);
  assert.deepEqual(posts.map((x) => x.slice(0, 2)), [['POST', '/workshop/plan']]);
  assert.equal(posts[0][2].summary, 'Drywall the kitchen in the morning; rain Sunday.');
  let ran = 0;
  await maybeRunPlan({ now: new Date('2026-11-28T00:05:00Z'), last: null, save: () => {}, runner: async () => { ran++; } });
  await maybeRunPlan({ now: new Date('2026-11-28T00:06:00Z'), last: '2026-11-27', save: () => {}, runner: async () => { ran++; } });
  assert.equal(ran, 1);
  assert.deepEqual(radarWants({ pickup: [{ item: 'Plywood' }, { item: 'Caulk' }] }, [{ item: 'Plywood 4x8' }]).map((w) => w.item), ['Caulk'], 'the radar skips what is on the Leftovers shelf');
  assert.equal(helperPathOk('/workshop/plan'), true);
});

test('v265: receipts credit the person who asked; the prompt covers receipts and timer-based estimates', async () => {
  const { createHelperTools } = await import('../server/workshop.js');
  assert.match(helperSystemPrompt(), /Receipts: when the photo is a store receipt/);
  assert.match(helperSystemPrompt(), /job timer/);
  const sent = [];
  const fetcher = async (m, p, b) => { sent.push([m, p, b]); return { status: 200, json: { ok: true, material: { item: 'Plywood' } }, body: '' }; };
  const server = createHelperTools([], fetcher);
  const tool = server.instance?._registeredTools?.materials || server.instance?._tools?.materials;
  if (tool?.callback || tool?.handler) {
    await (tool.callback || tool.handler)({ action: 'update', id: 'm1', haveIt: true, cost: 45.98, creditTo: 'Jake' });
    assert.deepEqual(sent[0], ['PATCH', '/homestead/materials/m1', { haveIt: true, cost: 45.98, creditTo: 'Jake' }]);
  }
});
