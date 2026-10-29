# Process Google Photos Takeout zips into a private index + small previews (for Morpheus).
# Usage: python3 process_takeout.py ZIP [ZIP...]   (appends to media.jsonl / meta.jsonl, then rebuilds index.jsonl)
#        python3 process_takeout.py --rebuild       (only rebuild index.jsonl, e.g. after geocoding)
import sys, os, json, zipfile, hashlib, io, re, time, urllib.request, urllib.parse
from PIL import Image, ImageOps
try:
    import pillow_heif; pillow_heif.register_heif_opener()
except Exception: pass
D = os.path.dirname(os.path.abspath(__file__))
PREV = os.path.join(D, 'previews'); os.makedirs(PREV, exist_ok=True)
IMG = {'.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp', '.gif', '.bmp', '.tif', '.tiff'}
VID = {'.mp4', '.mov', '.m4v', '.3gp', '.avi', '.mkv', '.webm'}

def key(folder, name):
    n = re.sub(r'-(edited|bearbeitet|modifié)(\.[^.]+)$', r'\2', name, flags=re.I)
    return (folder + '/' + n).lower()

def process(zp):
    mf = open(os.path.join(D, 'media.jsonl'), 'a'); jf = open(os.path.join(D, 'meta.jsonl'), 'a')
    n = {'photos': 0, 'videos': 0, 'meta': 0, 'errors': 0}
    with zipfile.ZipFile(zp) as z:
        for info in z.infolist():
            p = info.filename
            if info.is_dir() or '/Google Photos/' not in '/' + p: continue
            folder = p.split('/Google Photos/', 1)[1].rsplit('/', 1)[0] if '/' in p.split('/Google Photos/', 1)[1] else ''
            base = p.rsplit('/', 1)[-1]; ext = os.path.splitext(base)[1].lower()
            if ext == '.json':
                try: j = json.loads(z.read(info))
                except Exception: n['errors'] += 1; continue
                if 'title' not in j or base in ('metadata.json',):
                    continue
                g = j.get('geoData') or {}; ge = j.get('geoDataExif') or {}
                lat = g.get('latitude') or ge.get('latitude') or 0; lon = g.get('longitude') or ge.get('longitude') or 0
                jf.write(json.dumps({'k': key(folder, j['title']), 'folder': folder, 'title': j['title'],
                    'taken': int((j.get('photoTakenTime') or {}).get('timestamp') or 0) or None,
                    'lat': round(lat, 5) if lat else None, 'lon': round(lon, 5) if lon else None,
                    'people': [x.get('name') for x in (j.get('people') or []) if x.get('name')],
                    'desc': j.get('description') or ''}) + '\n'); n['meta'] += 1
            elif ext in IMG or ext in VID:
                pid = hashlib.sha1(p.encode()).hexdigest()[:16]
                rec = {'id': pid, 'k': key(folder, base), 'folder': folder, 'file': base, 'kind': 'video' if ext in VID else 'photo', 'bytes': info.file_size, 'preview': False}
                if ext in IMG:
                    out = os.path.join(PREV, pid + '.jpg')
                    try:
                        if not os.path.exists(out):
                            im = Image.open(io.BytesIO(z.read(info))); im = ImageOps.exif_transpose(im).convert('RGB'); im.thumbnail((512, 512)); im.save(out, 'JPEG', quality=70)
                        rec['preview'] = True
                    except Exception: n['errors'] += 1
                    n['photos'] += 1
                else: n['videos'] += 1
                mf.write(json.dumps(rec) + '\n')
    print('processed', os.path.basename(zp), n, flush=True)

def rebuild():
    meta = {}
    if os.path.exists(os.path.join(D, 'meta.jsonl')):
        for l in open(os.path.join(D, 'meta.jsonl')):
            m = json.loads(l); meta.setdefault(m['k'], m)
            meta.setdefault(('*/' + m['title']).lower(), m)  # fallback: same file name in another folder
    geo = {}
    gp = os.path.join(D, 'geocache.json')
    if os.path.exists(gp): geo = json.load(open(gp))
    seen = {}
    for l in open(os.path.join(D, 'media.jsonl')) if os.path.exists(os.path.join(D, 'media.jsonl')) else []:
        r = json.loads(l)
        m = meta.get(r['k']) or meta.get(('*/' + r['file']).lower()) or {}
        dk = (r['file'].lower(), m.get('taken'))
        albums = [] if re.match(r'^Photos from \d{4}$', r['folder']) or not r['folder'] else [r['folder']]
        if dk in seen and m.get('taken'):
            e = seen[dk]; e['albums'] = sorted(set(e['albums'] + albums)); e['preview'] = e['preview'] or r['preview']
            if not e['preview_id'] and r['preview']: e['preview_id'] = r['id']
            continue
        place = None
        if m.get('lat'): place = geo.get(f"{round(m['lat'], 2)},{round(m['lon'], 2)}")
        e = {'id': r['id'], 'file': r['file'], 'kind': r['kind'], 'taken': m.get('taken'), 'lat': m.get('lat'), 'lon': m.get('lon'),
             'place': place, 'people': m.get('people') or [], 'desc': m.get('desc') or '', 'albums': albums,
             'preview': r['preview'], 'preview_id': r['id'] if r['preview'] else None}
        seen[dk if m.get('taken') else (r['id'],)] = e
    with open(os.path.join(D, 'index.jsonl'), 'w') as f:
        for e in sorted(seen.values(), key=lambda e: e['taken'] or 0): f.write(json.dumps(e, ensure_ascii=False) + '\n')
    print('index', len(seen), flush=True)

def geocode(limit=2000):
    # Turn rounded coordinates into place names (OpenStreetMap Nominatim, 1 request/second, cached).
    gp = os.path.join(D, 'geocache.json'); geo = json.load(open(gp)) if os.path.exists(gp) else {}
    want = set()
    for l in open(os.path.join(D, 'meta.jsonl')) if os.path.exists(os.path.join(D, 'meta.jsonl')) else []:
        m = json.loads(l)
        if m.get('lat'): want.add(f"{round(m['lat'], 2)},{round(m['lon'], 2)}")
    todo = [w for w in want if w not in geo][:limit]
    for w in todo:
        lat, lon = w.split(',')
        try:
            q = urllib.parse.urlencode({'lat': lat, 'lon': lon, 'format': 'json', 'zoom': 14})
            req = urllib.request.Request('https://nominatim.openstreetmap.org/reverse?' + q, headers={'User-Agent': 'watson-morpheus-personal/1.0 (private photo index)'})
            a = json.load(urllib.request.urlopen(req, timeout=20)).get('address', {})
            geo[w] = ', '.join(x for x in [a.get('suburb') or a.get('village') or a.get('town') or a.get('city') or a.get('county'), a.get('state')] if x) or None
        except Exception: geo[w] = None
        time.sleep(1.1)
        json.dump(geo, open(gp, 'w'))
    print('geocoded', len(todo), 'of', len(want), flush=True)

if __name__ == '__main__':
    args = sys.argv[1:]
    if args == ['--rebuild']: rebuild()
    elif args == ['--geocode']: geocode(); rebuild()
    else:
        for zp in args: process(zp)
        rebuild()
