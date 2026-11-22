# The Southern cook's voice (Wolf Hall v274): reads Cook mode lines with Chatterbox (Resemble AI, MIT license),
# copying the voice from the short sample Jake recorded in the app (with his OK). Runs on the PC's GPU.
#
# Started once by server/cookvoice.js with ~/tts/.venv/bin/python; the model stays loaded. Reads one JSON
# request per line on stdin: {"text": ..., "voice": "/path/to/sample", "out": "/path/to/out.wav"} and answers
# one JSON line on stdout: {"ok": true, "out": ...} or {"ok": false, "error": ...}.
import json
import os
import sys

import soundfile as sf
import torch
from chatterbox.tts import ChatterboxTTS


def to_wav(src):
    """Phone recordings come as webm/mp4; Chatterbox wants a wav. PyAV decodes them without system ffmpeg."""
    if src.lower().endswith('.wav'):
        return src
    out = src + '.wav'
    if os.path.exists(out):
        return out
    import av
    import numpy as np
    frames = []
    with av.open(src) as c:
        res = av.AudioResampler(format='s16', layout='mono', rate=24000)
        for fr in c.decode(audio=0):
            for r in res.resample(fr):
                frames.append(r.to_ndarray().reshape(-1))
        for r in res.resample(None):
            frames.append(r.to_ndarray().reshape(-1))
    pcm = np.concatenate(frames).astype('float32') / 32768.0
    sf.write(out, pcm, 24000)
    return out


def main():
    # Only our JSON answers go to stdout; anything the libraries print goes to stderr.
    proto = sys.stdout
    sys.stdout = sys.stderr
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    model = ChatterboxTTS.from_pretrained(device=device)
    print(json.dumps({'ready': True, 'device': device}), file=proto, flush=True)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            voice = to_wav(req['voice'])
            # A warm, lively delivery: a little more expression, a little slower pacing.
            wav = model.generate(req['text'], audio_prompt_path=voice, exaggeration=0.6, cfg_weight=0.4)
            sf.write(req['out'], wav.squeeze(0).cpu().numpy(), model.sr, subtype='PCM_16')
            print(json.dumps({'ok': True, 'out': req['out']}), file=proto, flush=True)
        except Exception as e:  # one bad line never stops the reader
            print(json.dumps({'ok': False, 'error': str(e)[:300]}), file=proto, flush=True)


if __name__ == '__main__':
    main()
