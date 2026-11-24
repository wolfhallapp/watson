# Makes the planned slides (data/commercials/plan.json) one at a time through slide.py; skips ones already made, so it
# can stop and pick up again. --only NAME[,NAME] or --first N for a test batch. Log: data/commercials/run.log
import argparse, json, os, subprocess, sys, time

ROOT = '/mnt/c/Users/Owner/Documents/watson'

def words(path, p):
    """The title and line drawn by code (11/24: the image model misspells), keeping the picture without words as -clean.png.
    A ('80s): chunky yellow letters with a purple outline. B (realistic): white letters with a dark outline."""
    from PIL import Image, ImageDraw, ImageFont
    im = Image.open(path).convert('RGB'); im.save(path.replace('.png', '-clean.png'))
    d = ImageDraw.Draw(im)
    def font(size):
        for f in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf']:
            if os.path.exists(f): return ImageFont.truetype(f, size)
        return ImageFont.load_default(size=size)
    def fit(text, maxw, size):
        while size > 18 and d.textlength(text, font=font(size)) > maxw: size -= 2
        return font(size)
    fill, stroke = ((255, 222, 60), (90, 20, 120)) if p['style'] == 'A' else ((255, 255, 255), (15, 15, 25))
    ft = fit(p['title'], im.width * 0.92, int(im.height * 0.11)); fl = fit(p['line'], im.width * 0.9, int(im.height * 0.055))
    for text, f, y in [(p['title'], ft, int(im.height * 0.04)), (p['line'], fl, im.height - int(im.height * 0.055) - int(im.height * 0.06))]:
        x = (im.width - d.textlength(text, font=f)) / 2
        d.text((x, y), text, font=f, fill=fill, stroke_width=max(3, f.size // 10), stroke_fill=stroke)
    im.save(path)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--first', type=int); ap.add_argument('--only'); a = ap.parse_args()
    plan = json.load(open(os.path.join(ROOT, 'data/commercials/plan.json')))
    if a.only: plan = [p for p in plan if p['name'] in a.only.split(',')]
    if a.first: plan = plan[:a.first]
    log = open(os.path.join(ROOT, 'data/commercials/run.log'), 'a')
    for p in plan:
        out = os.path.join(ROOT, 'data/commercials/slides', p['name'] + '.png')
        if os.path.exists(out): continue
        t0 = time.time()
        r = subprocess.run([sys.executable, os.path.join(ROOT, 'scripts/commercials/slide.py'), '--out', p['name'], '--prompt', p['prompt'],
                            '--seed', str(p['seed']), '--steps', '20', '--cfg', '2.5', *[os.path.join(ROOT, f) for f in p['photos']]], capture_output=True, text=True)
        if r.returncode == 0: words(out, p)
        msg = f"{time.strftime('%H:%M')} {p['name']} {'ok' if r.returncode == 0 else 'FAILED ' + (r.stderr or r.stdout)[-300:]} {round(time.time() - t0)}s"
        print(msg, flush=True); log.write(msg + '\n'); log.flush()
    print('RUN DONE', flush=True)

if __name__ == '__main__':
    main()
