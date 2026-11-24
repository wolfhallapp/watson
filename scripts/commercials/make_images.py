# Stills for a family commercial: one image per scene from SDXL-Turbo (Stability AI, non-commercial community
# license: fine for private household use, never posted or sold). Runs on the RTX 5070 in fp16, about 7 GB.
# Usage: ~/ads-venv/bin/python make_images.py <spec.json> <outdir>
import json
import os
import sys

import torch
from diffusers import AutoPipelineForText2Image

spec = json.load(open(sys.argv[1]))
out = sys.argv[2]
os.makedirs(out, exist_ok=True)
pipe = AutoPipelineForText2Image.from_pretrained('stabilityai/sdxl-turbo', torch_dtype=torch.float16, variant='fp16').to('cuda')
for i, s in enumerate(spec['scenes']):
    prompt = f"{s['prompt']}, {spec.get('look', '')}"
    # Turbo makes its best picture in 1-4 steps with no guidance; 768x432 is 16:9 and still near its 512 training size.
    # Three seeds per scene so a person can pick the best one; build.mjs uses take 1 unless told otherwise.
    for take in (1, 2, 3):
        g = torch.Generator('cuda').manual_seed(1000 * (i + 1) + take)
        img = pipe(prompt=prompt, num_inference_steps=4, guidance_scale=0.0, width=768, height=432, generator=g).images[0]
        f = os.path.join(out, f'scene-{i + 1}-take{take}.png')
        img.save(f)
        print(f, flush=True)
