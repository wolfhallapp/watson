# Designed voices read by Qwen3-TTS's clone model (Apache-2.0), for voices Chatterbox can't hold (Trinity, 11/23:
# Horace: "1 works"). Started once by server/tts.js with ~/qwentts/.venv/bin/python; the model stays loaded.
# Same line protocol as cookvoice_serve.py: one JSON request per line on stdin
# {"text", "voice": "/path/ref.wav", "out": "/path/out.wav", "ref_text": "what the ref clip says"} and one JSON line back.
import json
import sys

import soundfile as sf
import torch
from qwen_tts import Qwen3TTSModel

model = Qwen3TTSModel.from_pretrained("Qwen/Qwen3-TTS-12Hz-1.7B-Base", device_map="cuda:0", dtype=torch.bfloat16)
prompts = {}
print(json.dumps({"ready": True, "device": "cuda"}), flush=True)
for line in sys.stdin:
    try:
        req = json.loads(line)
        key = req["voice"]
        if key not in prompts:
            prompts[key] = model.create_voice_clone_prompt(ref_audio=req["voice"], ref_text=req.get("ref_text") or None,
                                                           x_vector_only_mode=not req.get("ref_text"))
        wavs, sr = model.generate_voice_clone(text=str(req["text"])[:1000], language="English", voice_clone_prompt=prompts[key])
        sf.write(req["out"], wavs[0], sr)
        print(json.dumps({"ok": True, "out": req["out"]}), flush=True)
    except Exception as e:  # one bad line never stops the reader
        print(json.dumps({"ok": False, "error": str(e)[:300]}), flush=True)
