# A short music bed or sung jingle with ACE-Step 1.5 turbo (Apache-2.0 / MIT) through the local ComfyUI, using the
# official template's settings (8 steps, cfg 1, euler/simple, AuraFlow shift 3). Free, local, private.
#   python3 music.py --out path.flac --tags "upbeat game show jingle, ..." [--lyrics "[instrumental]"] [--seconds 20] [--bpm 120] [--key "C major"]
import argparse, json, os, random, shutil, time, urllib.request

COMFY = 'http://127.0.0.1:8188'
OUTPUT = os.path.expanduser('~/comfy/output')

def workflow(tags, lyrics, seconds, bpm, key, seed, prefix):
    return {
        'ckpt': {'class_type': 'CheckpointLoaderSimple', 'inputs': {'ckpt_name': 'ace_step_1.5_turbo_aio.safetensors'}},
        'shift': {'class_type': 'ModelSamplingAuraFlow', 'inputs': {'model': ['ckpt', 0], 'shift': 3.0}},
        'pos': {'class_type': 'TextEncodeAceStepAudio1.5', 'inputs': {'clip': ['ckpt', 1], 'tags': tags, 'lyrics': lyrics, 'seed': seed, 'bpm': bpm, 'duration': float(seconds),
                'timesignature': '4', 'language': 'en', 'keyscale': key, 'generate_audio_codes': True, 'cfg_scale': 2.0, 'temperature': 0.85, 'top_p': 0.9, 'top_k': 0, 'min_p': 0.0}},
        'neg': {'class_type': 'ConditioningZeroOut', 'inputs': {'conditioning': ['pos', 0]}},
        'latent': {'class_type': 'EmptyAceStep1.5LatentAudio', 'inputs': {'seconds': float(seconds), 'batch_size': 1}},
        'ks': {'class_type': 'KSampler', 'inputs': {'model': ['shift', 0], 'positive': ['pos', 0], 'negative': ['neg', 0], 'latent_image': ['latent', 0],
               'seed': seed, 'steps': 8, 'cfg': 1.0, 'sampler_name': 'euler', 'scheduler': 'simple', 'denoise': 1.0}},
        'dec': {'class_type': 'VAEDecodeAudio', 'inputs': {'samples': ['ks', 0], 'vae': ['ckpt', 2]}},
        'save': {'class_type': 'SaveAudio', 'inputs': {'audio': ['dec', 0], 'filename_prefix': prefix}},
    }

def post(path, body=None):
    req = urllib.request.Request(COMFY + path, data=json.dumps(body).encode() if body is not None else None, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r: return json.loads(r.read())

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True); ap.add_argument('--tags', required=True); ap.add_argument('--lyrics', default='[instrumental]')
    ap.add_argument('--seconds', type=float, default=20); ap.add_argument('--bpm', type=int, default=120); ap.add_argument('--key', default='C major')
    ap.add_argument('--seed', type=int, default=None)
    a = ap.parse_args()
    seed = a.seed if a.seed is not None else random.randint(1, 2**31)
    prefix = f'music/m-{seed}'
    pid = post('/prompt', {'prompt': workflow(a.tags, a.lyrics, a.seconds, a.bpm, a.key, seed, prefix)})['prompt_id']
    t0 = time.time()
    while True:
        time.sleep(4)
        h = post('/history/' + pid)
        if pid in h:
            st = h[pid].get('status', {})
            if st.get('status_str') == 'error': raise SystemExit('ComfyUI error: ' + json.dumps(st)[:800])
            files = [x for o in h[pid]['outputs'].values() for x in o.get('audio', [])]
            if files:
                src = os.path.join(OUTPUT, files[0].get('subfolder', ''), files[0]['filename'])
                os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True); shutil.copy(src, a.out)
                print(json.dumps({'ok': True, 'out': a.out, 'seed': seed, 'seconds': round(time.time() - t0)})); return
        if time.time() - t0 > 1800: raise SystemExit('timed out')

if __name__ == '__main__':
    main()
