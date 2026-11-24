# Makes one short AI video clip from a picture with Wan 2.2 TI2V-5B (Apache-2.0) through the local ComfyUI
# (http://127.0.0.1:8188). Free, local, private: nothing leaves this PC.
#   python3 video.py --out NAME --prompt "what happens" picture.png [--w 832 --h 480 --frames 49 --steps 20 --cfg 5]
# Frames are saved by ComfyUI, then joined into data/commercials/clips/NAME.mp4 with ffmpeg (24 fps).
import argparse, json, os, random, shutil, subprocess, time, urllib.request, glob

COMFY = 'http://127.0.0.1:8188'
INPUT = os.path.expanduser('~/comfy/input')
OUTPUT = os.path.expanduser('~/comfy/output')
CLIPS = '/mnt/c/Users/Owner/Documents/watson/data/commercials/clips'
NEG = ('blurry, distorted face, deformed, extra fingers, extra limbs, melting, morphing face, flicker, text artifacts, '
       'watermark, low quality, static, still image')


def workflow(image, prompt, w, h, frames, steps, cfg, seed, prefix):
    return {
        'unet': {'class_type': 'UNETLoader', 'inputs': {'unet_name': 'wan2.2_ti2v_5B_fp16.safetensors', 'weight_dtype': 'default'}},
        'clip': {'class_type': 'CLIPLoader', 'inputs': {'clip_name': 'umt5_xxl_fp8_e4m3fn_scaled.safetensors', 'type': 'wan', 'device': 'default'}},
        'vae': {'class_type': 'VAELoader', 'inputs': {'vae_name': 'wan2.2_vae.safetensors'}},
        'shift': {'class_type': 'ModelSamplingSD3', 'inputs': {'model': ['unet', 0], 'shift': 8.0}},
        'pos': {'class_type': 'CLIPTextEncode', 'inputs': {'clip': ['clip', 0], 'text': prompt}},
        'neg': {'class_type': 'CLIPTextEncode', 'inputs': {'clip': ['clip', 0], 'text': NEG}},
        'load': {'class_type': 'LoadImage', 'inputs': {'image': image}},
        'fit': {'class_type': 'ImageScale', 'inputs': {'image': ['load', 0], 'upscale_method': 'lanczos', 'width': w, 'height': h, 'crop': 'center'}},
        'latent': {'class_type': 'Wan22ImageToVideoLatent', 'inputs': {'vae': ['vae', 0], 'width': w, 'height': h, 'length': frames, 'batch_size': 1, 'start_image': ['fit', 0]}},
        'ks': {'class_type': 'KSampler', 'inputs': {'model': ['shift', 0], 'positive': ['pos', 0], 'negative': ['neg', 0], 'latent_image': ['latent', 0],
                                                    'seed': seed, 'steps': steps, 'cfg': cfg, 'sampler_name': 'uni_pc', 'scheduler': 'simple', 'denoise': 1.0}},
        'dec': {'class_type': 'VAEDecode', 'inputs': {'samples': ['ks', 0], 'vae': ['vae', 0]}},
        'save': {'class_type': 'SaveImage', 'inputs': {'images': ['dec', 0], 'filename_prefix': prefix}},
    }


def to_mp4(frames, dst, fps=24):
    """Joins PNG frames into an H.264 MP4 with PyAV (ships with ComfyUI's venv; no ffmpeg install needed)."""
    import av
    from PIL import Image
    first = Image.open(frames[0]); w, h = first.size
    with av.open(dst, mode='w') as out:
        s = out.add_stream('libx264', rate=fps); s.width, s.height, s.pix_fmt = w - w % 2, h - h % 2, 'yuv420p'; s.options = {'crf': '18'}
        for f in frames:
            im = Image.open(f).convert('RGB').crop((0, 0, s.width, s.height))
            for p in s.encode(av.VideoFrame.from_image(im)): out.mux(p)
        for p in s.encode(): out.mux(p)


def post(path, body=None):
    req = urllib.request.Request(COMFY + path, data=json.dumps(body).encode() if body is not None else None, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('picture'); ap.add_argument('--out', required=True); ap.add_argument('--prompt', required=True)
    ap.add_argument('--w', type=int, default=832); ap.add_argument('--h', type=int, default=480)
    ap.add_argument('--frames', type=int, default=49); ap.add_argument('--steps', type=int, default=20)
    ap.add_argument('--cfg', type=float, default=5.0); ap.add_argument('--seed', type=int, default=None)
    a = ap.parse_args()
    os.makedirs(INPUT, exist_ok=True); os.makedirs(CLIPS, exist_ok=True)
    name = 'vid-' + os.path.basename(a.picture); shutil.copy(a.picture, os.path.join(INPUT, name))
    seed = a.seed if a.seed is not None else random.randint(1, 2**31)
    prefix = f'clip-{a.out}-{seed}'
    pid = post('/prompt', {'prompt': workflow(name, a.prompt, a.w, a.h, a.frames, a.steps, a.cfg, seed, prefix)})['prompt_id']
    t0 = time.time()
    while True:
        time.sleep(10)
        h = post('/history/' + pid)
        if pid in h:
            st = h[pid].get('status', {})
            if st.get('status_str') == 'error': raise SystemExit('ComfyUI error: ' + json.dumps(st)[:800])
            if h[pid].get('outputs'): break
        if time.time() - t0 > 7200: raise SystemExit('timed out')
    frames = sorted(glob.glob(os.path.join(OUTPUT, prefix + '_*.png')))
    if not frames: raise SystemExit('no frames saved')
    dst = os.path.join(CLIPS, a.out + '.mp4')
    to_mp4(frames, dst)
    for f in frames: os.remove(f)
    print(json.dumps({'ok': True, 'out': dst, 'frames': len(frames), 'seed': seed, 'seconds': round(time.time() - t0)}))


if __name__ == '__main__':
    main()
