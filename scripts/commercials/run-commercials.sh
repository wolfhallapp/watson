#!/usr/bin/env bash
# Makes every commercial in data/commercials/specs that has no finished MP4 yet, one at a time, in ONE held WSL
# session with ComfyUI (11/24: WSL shut down between calls and took ComfyUI with it). Resumable. Log: data/commercials/ads.log
#   bash scripts/commercials/run-commercials.sh [spec-name ...]
cd /mnt/c/Users/Owner/Documents/watson || exit 1
export PATH=/home/horacehall/.nvm/versions/node/v24.19.0/bin:$PATH
PY=~/comfy/.venv/bin/python
while pgrep -f 'commercials/run-slides.py' >/dev/null; do sleep 20; done   # the slide run goes first
if ! curl -s -o /dev/null http://127.0.0.1:8188/; then
  (cd ~/comfy && exec .venv/bin/python main.py --listen 127.0.0.1 --port 8188 > /tmp/comfy.log 2>&1) &
  for i in $(seq 90); do curl -s -o /dev/null http://127.0.0.1:8188/ && break; sleep 2; done
fi
LOG=data/commercials/ads.log
specs=("$@"); [ ${#specs[@]} -eq 0 ] && specs=($(ls data/commercials/specs/*.json | xargs -n1 basename | sed 's/\.json$//'))
for s in "${specs[@]}"; do
  f=data/commercials/specs/$s.json; name=$($PY -c "import json,sys; print(json.load(open(sys.argv[1]))['name'])" "$f")
  [ -f "data/commercials/$name/$name.mp4" ] && continue
  t0=$(date +%s)
  if out=$($PY scripts/commercials/commercial.py "$f" 2>&1); then msg="$(date +%H:%M) $name ok $(( $(date +%s) - t0 ))s"
  else msg="$(date +%H:%M) $name FAILED $(echo "$out" | tail -c 300 | tr '\n' ' ')"; fi
  echo "$msg"; echo "$msg" >> "$LOG"
done
echo "ADS DONE"
