# One family commercial (Horace 11/24): wide text-free scene stills from the person's own photos (Qwen-Image-Edit),
# each animated into a 5-second clip (Wan 2.2), a voice-over in a designed voice, optional music (ACE-Step 1.5),
# and clean title / punchline text drawn on afterward so words never garble. Free, local, private.
#   python3 commercial.py spec.json      (run with ~/comfy/.venv/bin/python; ComfyUI must be up for the picture steps)
# spec: {name, voice, photos:[...], keep, scenes:[{prompt, motion}], lines:[{at, text}], title, punch, music?:{tags, lyrics}}
import json, os, subprocess, sys, glob, random
import numpy as np
from PIL import Image, ImageOps, ImageFilter, ImageDraw, ImageFont

ROOT = '/mnt/c/Users/Owner/Documents/watson'
OUT = os.path.join(ROOT, 'data/commercials')
PY = sys.executable
W, H, FPS, FRAMES = 832, 480, 24, 121  # 16:9-ish for the TV, ~5 s per clip
SR = 44100

def run(*cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if r.returncode: raise SystemExit(f'{cmd[1] if len(cmd) > 1 else cmd[0]} failed: {(r.stderr or r.stdout)[-600:]}')
    return r.stdout

def upright(photo, dst):
    """The photo the right way up, as it is. 11/24: padding it to 16:9 with a blurred copy of itself put the person
    in the scene twice; now slide.py paints a fresh 16:9 canvas (--size) from the photo instead."""
    im = ImageOps.exif_transpose(Image.open(photo)).convert('RGB')
    im.thumbnail((1600, 1600)); im.save(dst, quality=92)

def font(size):
    for f in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf']:
        if os.path.exists(f): return ImageFont.truetype(f, size)
    return ImageFont.load_default(size=size)

def caption(im, text, where, size):
    d = ImageDraw.Draw(im); f = font(size)
    words, lines, cur = text.split(), [], ''
    for w in words:
        t = (cur + ' ' + w).strip()
        if d.textlength(t, font=f) > im.width * 0.9 and cur: lines.append(cur); cur = w
        else: cur = t
    lines.append(cur)
    lh = size + 8; y = int(im.height * 0.06) if where == 'top' else im.height - lh * len(lines) - int(im.height * 0.07)
    for ln in lines:
        x = (im.width - d.textlength(ln, font=f)) / 2
        d.text((x, y), ln, font=f, fill=(255, 230, 90), stroke_width=max(3, size // 12), stroke_fill=(20, 10, 40))
        y += lh
    return im

def load_audio(path):
    import av
    c = av.open(path); rs = av.AudioResampler(format='fltp', layout='stereo', rate=SR); chunks = []
    for fr in c.decode(audio=0):
        for o in rs.resample(fr): chunks.append(o.to_ndarray())
    for o in rs.resample(None): chunks.append(o.to_ndarray())
    return np.concatenate(chunks, axis=1) if chunks else np.zeros((2, 0), np.float32)

def main():
    spec = json.load(open(sys.argv[1])); name = spec['name']
    work = os.path.join(OUT, 'work', name); os.makedirs(work, exist_ok=True)
    # 0. Voice-over first, with ComfyUI's models out of the graphics card; the voice readers are closed after.
    todo = [(j, ln) for j, ln in enumerate(spec['lines']) if not os.path.exists(os.path.join(work, f'line{j}.wav'))]
    if todo:
        try:
            import urllib.request
            urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8188/free', data=b'{"unload_models": true, "free_memory": true}', headers={'Content-Type': 'application/json'}), timeout=30)
        except Exception: pass
        for j, ln in todo: run('node', os.path.join(ROOT, 'scripts/commercials/say.mjs'), spec['voice'], os.path.join(work, f'line{j}.wav'), ln['text'], cwd=ROOT)
        subprocess.run(['pkill', '-f', 'cookvoice_serve.py|qwenclone_serve.py'])
    # 1. Wide, text-free scene stills from the person's own photos.
    srcs = []
    for i, p in enumerate(spec['photos'][:1]):  # 11/24 tests: a second photo of the same person adds a second person
        d = os.path.join(work, f'src{i}.jpg'); upright(os.path.join(ROOT, p), d); srcs.append(d)
    clips = []
    for i, sc in enumerate(spec['scenes']):
        still = os.path.join(OUT, 'slides', f'{name}-scene{i + 1}.png')
        if not os.path.exists(still):
            prompt = (f"{sc['prompt']} {spec['keep']} Wide 16:9 TV commercial shot. Exactly ONE {spec.get('kind', 'person')} in the picture, "
                      'large and clearly visible, the whole face showing with nothing in front of it. '
                      'Absolutely no text, no letters, no words, no signs anywhere in the image.')
            run(PY, os.path.join(ROOT, 'scripts/commercials/slide.py'), '--out', f'{name}-scene{i + 1}', '--prompt', prompt,
                '--fast', '--size', '1344x768', '--seed', str(spec.get('seed', 1000) + i), *srcs)
        clip = os.path.join(OUT, 'clips', f'{name}-scene{i + 1}.mp4')
        if not os.path.exists(clip):
            run(PY, os.path.join(ROOT, 'scripts/commercials/video.py'), '--out', f'{name}-scene{i + 1}', '--w', str(W), '--h', str(H), '--frames', str(FRAMES),
                '--prompt', sc['motion'] + ', the face stays exactly the same, smooth natural motion, steady camera', still)
        clips.append(clip)
    # 2. Frames, with the title on the first clip and the punchline on the last.
    import av
    frames, last_clean = [], None
    for ci, c in enumerate(clips):
        for k, fr in enumerate(av.open(c).decode(video=0)):
            im = fr.to_image().convert('RGB'); last_clean = im.copy()
            if ci == 0 and k >= 6: caption(im, spec['title'], 'top', 52)
            if ci == len(clips) - 1 and k >= FRAMES // 3: caption(im, spec['punch'], 'bottom', 40)
            frames.append(im)
    end = last_clean.filter(ImageFilter.GaussianBlur(6))  # the end card starts from a frame with no words on it
    caption(end, spec['title'], 'top', 52); caption(end, 'A WOLF HALL PRODUCTION', 'bottom', 30)
    frames += [end] * (FPS * 2)
    secs = len(frames) / FPS
    # 3. Voice-over lines (generated before the picture steps by the caller, or here if missing) and music.
    mix = np.zeros((2, int(secs * SR)), np.float32); talk = np.zeros(mix.shape[1], np.float32)
    for j, ln in enumerate(spec['lines']):
        wav = os.path.join(work, f'line{j}.wav')
        if not os.path.exists(wav): run('node', os.path.join(ROOT, 'scripts/commercials/say.mjs'), spec['voice'], wav, ln['text'], cwd=ROOT)
        a = load_audio(wav); s = int(ln['at'] * SR); e = min(mix.shape[1], s + a.shape[1])
        mix[:, s:e] += a[:, :e - s]; talk[s:e] = 1
    music = os.path.join(work, 'music.flac')
    if spec.get('music') and not os.path.exists(music) and os.path.exists(os.path.expanduser('~/comfy/models/checkpoints/ace_step_1.5_turbo_aio.safetensors')):
        mu = spec['music']
        run(PY, os.path.join(ROOT, 'scripts/commercials/music.py'), '--out', music, '--tags', mu['tags'], '--lyrics', mu.get('lyrics', '[instrumental]'),
            '--seconds', str(round(secs + 1)), '--bpm', str(mu.get('bpm', 120)), '--key', mu.get('key', 'C major'))
    if os.path.exists(music):
        m = load_audio(music)
        if m.shape[1] < mix.shape[1]: m = np.tile(m, (1, mix.shape[1] // max(1, m.shape[1]) + 1))
        m = m[:, :mix.shape[1]]
        duck = np.convolve(talk, np.ones(SR // 4) / (SR // 4), mode='same')  # soften the dip in and out
        gain = 0.32 - 0.2 * np.clip(duck, 0, 1)
        fade = np.minimum(1, np.minimum(np.arange(m.shape[1]) / (SR * 0.5), (m.shape[1] - np.arange(m.shape[1])) / (SR * 1.5)))
        mix += m * gain * fade
    peak = np.abs(mix).max() or 1; mix = (mix / max(1, peak / 0.95)).astype(np.float32)
    # 4. One MP4 with picture and sound.
    dst = os.path.join(OUT, name, name + '.mp4'); os.makedirs(os.path.dirname(dst), exist_ok=True)
    with av.open(dst, 'w') as o:
        vs = o.add_stream('libx264', rate=FPS); vs.width, vs.height, vs.pix_fmt = W, H, 'yuv420p'; vs.options = {'crf': '18'}
        as_ = o.add_stream('aac', rate=SR); as_.layout = 'stereo'
        for im in frames:
            for p in vs.encode(av.VideoFrame.from_image(im.resize((W, H)))): o.mux(p)
        for p in vs.encode(): o.mux(p)
        step = 1024
        for s in range(0, mix.shape[1], step):
            fr = av.AudioFrame.from_ndarray(np.ascontiguousarray(mix[:, s:s + step]), format='fltp', layout='stereo'); fr.sample_rate = SR; fr.pts = s
            for p in as_.encode(fr): o.mux(p)
        for p in as_.encode(): o.mux(p)
    print(json.dumps({'ok': True, 'out': dst, 'seconds': round(secs, 1), 'music': os.path.exists(music)}))

if __name__ == '__main__':
    main()
