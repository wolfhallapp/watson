# Private photo picker (Horace 11/24): every photo from his Google Photos export, filter by person (Google's own
# tags) and year, tap to pick. Picks are saved to ~/.oracle-private/photos/picks.json for the commercials.
# Runs on this PC only (127.0.0.1): open http://localhost:8795 on the PC or over Remote Desktop. Nothing leaves the PC.
#   python3 scripts/commercials/photo-picker.py
import json, os, re, datetime
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from collections import Counter

P = os.path.expanduser('~/.oracle-private/photos')
PICKS = os.path.join(P, 'picks.json')
PORT = int(os.environ.get('PICKER_PORT', '8795'))

def load():
    rows = []
    for line in open(os.path.join(P, 'index.jsonl')):
        r = json.loads(line)
        if r.get('kind') != 'photo' or not r.get('preview_id'): continue
        t = r.get('taken')
        try: d = datetime.datetime.fromtimestamp(int(t)).strftime('%Y-%m-%d') if t else ''
        except Exception: d = ''
        rows.append({'id': r['id'], 'p': r['preview_id'], 'd': d, 'who': r.get('people') or [], 'place': r.get('place') or '', 'file': r.get('file') or ''})
    rows.sort(key=lambda x: x['d'] or '0', reverse=True)
    return rows

ROWS = load()
PEOPLE = [n for n, _ in Counter(p for r in ROWS for p in r['who']).most_common(16)]

def picks():
    try: return json.load(open(PICKS))
    except Exception: return []

PAGE = r"""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Photo Picker</title><style>
:root{--bg:#101010;--fg:#eee;--dim:#999;--gold:#d4af37;--chip:#222}
body{margin:0;background:var(--bg);color:var(--fg);font:15px system-ui,sans-serif}
header{position:sticky;top:0;background:#000d;backdrop-filter:blur(6px);padding:10px 16px;z-index:2}
h1{font-size:18px;margin:0 0 8px}.chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px}
button,select{background:var(--chip);color:var(--fg);border:1px solid #333;border-radius:16px;padding:6px 12px;font:inherit;cursor:pointer}
button.on{background:var(--gold);color:#111;border-color:var(--gold)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:4px;padding:8px 16px 80px}
.t{position:relative;aspect-ratio:1;overflow:hidden;border-radius:6px;background:#222;cursor:pointer;border:3px solid transparent}
.t img{width:100%;height:100%;object-fit:cover;display:block}.t.sel{border-color:var(--gold)}
.t .n{position:absolute;left:0;right:0;bottom:0;font-size:10px;background:#000a;padding:2px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.t.sel::after{content:"\2713";position:absolute;top:4px;right:6px;background:var(--gold);color:#111;border-radius:50%;width:22px;height:22px;text-align:center;font-weight:700;line-height:22px}
.dim{color:var(--dim);font-size:13px}#big{position:fixed;inset:0;background:#000e;display:none;align-items:center;justify-content:center;z-index:5;flex-direction:column}
#big img{max-width:96vw;max-height:80vh}#big div{margin-top:10px;display:flex;gap:8px}
</style></head><body>
<header><h1>Pick photos for the commercials <span class="dim" id="count"></span></h1>
<div class="chips" id="people"></div>
<div class="chips"><select id="year"></select><button id="mine">Show my picks</button></div>
<div class="dim">Tap a photo to pick it (gold check). Press and hold, or right-click, to see it bigger. Picks save as you go.</div></header>
<div class="grid" id="grid"></div>
<div id="big"><img id="bigimg"><div><button id="bigpick">Pick</button><button onclick="document.getElementById('big').style.display='none'">Close</button></div></div>
<script>
let ROWS=[], PICKS=new Set(), who='', year='', mineOnly=false, shown=0, list=[], bigId='';
const g=document.getElementById('grid');
async function boot(){const d=await (await fetch('/data')).json();ROWS=d.rows;PICKS=new Set(d.picks);
 const pe=document.getElementById('people');['Everyone'].concat(d.people).forEach(n=>{const b=document.createElement('button');b.textContent=n;b.onclick=()=>{who=n==='Everyone'?'':n;[...pe.children].forEach(c=>c.classList.toggle('on',c===b));apply()};if(n==='Everyone')b.classList.add('on');pe.appendChild(b)});
 const ys=[...new Set(ROWS.map(r=>r.d.slice(0,4)).filter(Boolean))].sort().reverse();const y=document.getElementById('year');y.innerHTML='<option value="">All years</option>'+ys.map(x=>'<option>'+x+'</option>').join('');y.onchange=()=>{year=y.value;apply()};
 document.getElementById('mine').onclick=e=>{mineOnly=!mineOnly;e.target.classList.toggle('on',mineOnly);apply()};apply()}
function apply(){list=ROWS.filter(r=>(!who||r.who.includes(who))&&(!year||r.d.startsWith(year))&&(!mineOnly||PICKS.has(r.id)));g.innerHTML='';shown=0;more();count()}
function count(){document.getElementById('count').textContent='('+list.length+' shown, '+PICKS.size+' picked)'}
function tile(r){const t=document.createElement('div');t.className='t'+(PICKS.has(r.id)?' sel':'');t.innerHTML='<img loading="lazy" src="/p/'+r.p+'.jpg"><div class="n">'+(r.who.join(', ')||r.d)+'</div>';
 t.onclick=()=>toggle(r.id,t);t.oncontextmenu=e=>{e.preventDefault();big(r)};let h;t.ontouchstart=()=>{h=setTimeout(()=>big(r),550)};t.ontouchend=()=>clearTimeout(h);return t}
function more(){list.slice(shown,shown+120).forEach(r=>g.appendChild(tile(r)));shown+=120}
window.onscroll=()=>{if(innerHeight+scrollY>document.body.offsetHeight-800&&shown<list.length)more()};
async function toggle(id,t){const on=!PICKS.has(id);on?PICKS.add(id):PICKS.delete(id);if(t)t.classList.toggle('sel',on);count();
 await fetch('/pick',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,on})})}
function big(r){bigId=r.id;document.getElementById('bigimg').src='/p/'+r.p+'.jpg';document.getElementById('big').style.display='flex';
 const b=document.getElementById('bigpick');b.textContent=PICKS.has(r.id)?'Unpick':'Pick';b.onclick=()=>{toggle(r.id,[...g.children].find(x=>x.querySelector('img').src.endsWith(r.p+'.jpg')));b.textContent=PICKS.has(r.id)?'Unpick':'Pick'}}
boot();
</script></body></html>"""

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, body, ctype):
        self.send_response(code); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store' if ctype.startswith(('text/html', 'application/json')) else 'max-age=86400'); self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        if self.path in ('/', '/index.html'): return self.send(200, PAGE.encode(), 'text/html; charset=utf-8')
        if self.path == '/data': return self.send(200, json.dumps({'rows': ROWS, 'people': PEOPLE, 'picks': picks()}).encode(), 'application/json')
        m = re.fullmatch(r'/p/([\w-]{1,80})\.jpg', self.path)
        if m:
            f = os.path.join(P, 'previews', m.group(1) + '.jpg')
            if os.path.isfile(f): return self.send(200, open(f, 'rb').read(), 'image/jpeg')
        self.send(404, b'not found', 'text/plain')
    def do_POST(self):
        if self.path != '/pick': return self.send(404, b'', 'text/plain')
        try:
            b = json.loads(self.rfile.read(int(self.headers.get('Content-Length', '0') or 0)) or b'{}')
            ids = {r['id'] for r in ROWS}
            if b.get('id') not in ids: return self.send(400, b'{"error":"unknown photo"}', 'application/json')
            cur = [x for x in picks() if x != b['id']]
            if b.get('on'): cur.append(b['id'])
            tmp = PICKS + '.tmp'; json.dump(cur, open(tmp, 'w')); os.replace(tmp, PICKS)
            self.send(200, json.dumps({'ok': True, 'count': len(cur)}).encode(), 'application/json')
        except Exception as e: self.send(500, json.dumps({'error': str(e)}).encode(), 'application/json')

if __name__ == '__main__':
    print(f'Photo picker: {len(ROWS)} photos, people {PEOPLE[:8]}... on http://localhost:{PORT}')
    ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
