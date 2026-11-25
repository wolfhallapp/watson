# Makes one family "commercial slide" with Qwen-Image-Edit-2511 (Apache-2.0) through a local ComfyUI
# (http://127.0.0.1:8188). Free, local, private: nothing leaves this PC.
#   python slide.py --out NAME --prompt "..." photo1.jpg [photo2.jpg [photo3.jpg]] [--steps 20] [--cfg 2.5] [--seed N]
# The finished PNG lands in watson data/commercials/slides/NAME.png.
import argparse, json, os, random, shutil, time, urllib.request

COMFY = "http://127.0.0.1:8188"
INPUT = os.path.expanduser("~/comfy/input")
OUTPUT = os.path.expanduser("~/comfy/output")
SLIDES = "/mnt/c/Users/Owner/Documents/watson/data/commercials/slides"
NEG = "blurry, deformed face, extra fingers, distorted text, watermark, low quality"


LIGHTNING = "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors"  # lightx2v, Apache-2.0: 4 steps instead of 20


def workflow(images, prompt, steps, cfg, seed, prefix, fast=False):
    g = {
        "unet": {"class_type": "UnetLoaderGGUF", "inputs": {"unet_name": "qwen-image-edit-2511-Q4_K_S.gguf"}},
        "clip": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen_2.5_vl_7b_fp8_scaled.safetensors", "type": "qwen_image", "device": "default"}},
        "vae": {"class_type": "VAELoader", "inputs": {"vae_name": "qwen_image_vae.safetensors"}},
    }
    model = ["unet", 0]
    if fast:
        g["lora"] = {"class_type": "LoraLoaderModelOnly", "inputs": {"model": model, "lora_name": LIGHTNING, "strength_model": 1.0}}
        model = ["lora", 0]
    g["shift"] = {"class_type": "ModelSamplingAuraFlow", "inputs": {"model": model, "shift": 3.1}}
    pos = {"clip": ["clip", 0], "prompt": prompt, "vae": ["vae", 0]}
    neg = {"clip": ["clip", 0], "prompt": NEG, "vae": ["vae", 0]}
    for i, img in enumerate(images, 1):
        g[f"load{i}"] = {"class_type": "LoadImage", "inputs": {"image": img}}
        g[f"scale{i}"] = {"class_type": "ImageScaleToTotalPixels", "inputs": {"image": [f"load{i}", 0], "upscale_method": "lanczos", "megapixels": 1.0, "resolution_steps": 8}}
        pos[f"image{i}"] = neg[f"image{i}"] = [f"scale{i}", 0]
    g["pos"] = {"class_type": "TextEncodeQwenImageEditPlus", "inputs": pos}
    g["neg"] = {"class_type": "TextEncodeQwenImageEditPlus", "inputs": neg}
    g["latent"] = {"class_type": "VAEEncode", "inputs": {"pixels": ["scale1", 0], "vae": ["vae", 0]}}
    g["ks"] = {"class_type": "KSampler", "inputs": {"model": ["shift", 0], "positive": ["pos", 0], "negative": ["neg", 0], "latent_image": ["latent", 0],
                                                    "seed": seed, "steps": steps, "cfg": cfg, "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0}}
    g["dec"] = {"class_type": "VAEDecode", "inputs": {"samples": ["ks", 0], "vae": ["vae", 0]}}
    g["save"] = {"class_type": "SaveImage", "inputs": {"images": ["dec", 0], "filename_prefix": prefix}}
    return g


def post(path, body=None):
    req = urllib.request.Request(COMFY + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("photos", nargs="+")
    ap.add_argument("--out", required=True)
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--steps", type=int, default=20)
    ap.add_argument("--cfg", type=float, default=2.5)
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--fast", action="store_true", help="Lightning add-on: 4 steps, cfg 1 (about 4x faster)")
    a = ap.parse_args()
    if a.fast: a.steps, a.cfg = 4, 1.0
    os.makedirs(INPUT, exist_ok=True); os.makedirs(SLIDES, exist_ok=True)
    names = []
    for p in a.photos[:3]:
        n = os.path.basename(p); shutil.copy(p, os.path.join(INPUT, n)); names.append(n)
    seed = a.seed if a.seed is not None else random.randint(1, 2**31)
    pid = post("/prompt", {"prompt": workflow(names, a.prompt, a.steps, a.cfg, seed, "slide-" + a.out, a.fast)})["prompt_id"]
    t0 = time.time()
    while True:
        time.sleep(5)
        h = post("/history/" + pid)
        if pid in h:
            st = h[pid].get("status", {})
            if st.get("status_str") == "error":
                raise SystemExit("ComfyUI error: " + json.dumps(st)[:800])
            imgs = [i for o in h[pid]["outputs"].values() for i in o.get("images", [])]
            if imgs:
                src = os.path.join(OUTPUT, imgs[0].get("subfolder", ""), imgs[0]["filename"])
                dst = os.path.join(SLIDES, a.out + ".png"); shutil.copy(src, dst)
                print(json.dumps({"ok": True, "out": dst, "seed": seed, "seconds": round(time.time() - t0)}))
                return
        if time.time() - t0 > 3600:
            raise SystemExit("timed out")


if __name__ == "__main__":
    main()
