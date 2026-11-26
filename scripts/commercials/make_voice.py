# Voice-over for a family commercial: one wav per scene line, read by Chatterbox (Resemble AI, MIT) on the GPU.
# Usage: ~/tts/.venv/bin/python make_voice.py <spec.json> <outdir> [voice-sample.wav]
# With no sample it uses Chatterbox's built-in voice; build.mjs lowers the pitch for Pappy. Never a cloned real person.
import json
import os
import sys

import soundfile as sf
import torch
from chatterbox.tts import ChatterboxTTS

spec = json.load(open(sys.argv[1]))
out = sys.argv[2]
sample = sys.argv[3] if len(sys.argv) > 3 else None
os.makedirs(out, exist_ok=True)
v = spec.get('voice', {})
model = ChatterboxTTS.from_pretrained(device='cuda' if torch.cuda.is_available() else 'cpu')
torch.manual_seed(7)
for i, s in enumerate(spec['scenes']):
    wav = model.generate(s['say'], audio_prompt_path=sample, exaggeration=v.get('exaggeration', 0.6), cfg_weight=v.get('cfg', 0.4))
    f = os.path.join(out, f'voice-{i + 1}.wav')
    sf.write(f, wav.squeeze(0).cpu().numpy(), model.sr, subtype='PCM_16')
    print(f, round(wav.shape[-1] / model.sr, 2), 's', flush=True)
