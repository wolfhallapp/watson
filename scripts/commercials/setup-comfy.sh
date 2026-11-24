#!/usr/bin/env bash
# Sets up ComfyUI (GPL-3.0, free) in WSL for the family commercials (Horace 11/23): Qwen-Image-Edit-2511 for the
# slides and Wan 2.2 TI2V-5B for motion. Every model here is Apache-2.0. Runs once; safe to re-run (skips what's there).
set -euo pipefail
C=~/comfy
[ -d "$C/.git" ] || git clone --depth 1 https://github.com/comfyanonymous/ComfyUI "$C"
cd "$C"
[ -d custom_nodes/ComfyUI-GGUF ] || git clone --depth 1 https://github.com/city96/ComfyUI-GGUF custom_nodes/ComfyUI-GGUF
[ -x .venv/bin/python ] || uv venv -p 3.12 .venv
uv pip install -p .venv/bin/python torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
uv pip install -p .venv/bin/python -r requirements.txt -r custom_nodes/ComfyUI-GGUF/requirements.txt huggingface_hub hf_xet
echo "== ComfyUI installed"
.venv/bin/python - <<'EOF'
import os, shutil
from huggingface_hub import hf_hub_download
M = os.path.expanduser('~/comfy/models')
want = [
  ('unsloth/Qwen-Image-Edit-2511-GGUF', 'qwen-image-edit-2511-Q4_K_S.gguf', 'unet'),
  ('Comfy-Org/Qwen-Image_ComfyUI', 'split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors', 'text_encoders'),
  ('Comfy-Org/Qwen-Image_ComfyUI', 'split_files/vae/qwen_image_vae.safetensors', 'vae'),
  ('Comfy-Org/Wan_2.2_ComfyUI_Repackaged', 'split_files/vae/wan2.2_vae.safetensors', 'vae'),
  ('Comfy-Org/Wan_2.2_ComfyUI_Repackaged', 'split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors', 'text_encoders'),
  ('Comfy-Org/Wan_2.2_ComfyUI_Repackaged', 'split_files/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors', 'diffusion_models'),
]
for repo, f, sub in want:
    dst = os.path.join(M, sub, os.path.basename(f))
    if os.path.exists(dst): print('have', dst, flush=True); continue
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    p = hf_hub_download(repo, f)
    os.symlink(p, dst)
    print('got', dst, flush=True)
print('ALL MODELS READY', flush=True)
EOF
