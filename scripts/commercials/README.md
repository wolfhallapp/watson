# Family commercials for the kitchen TV (Night Shift #122)

Private, kind, funny spots about the household for the kitchen display (the TV on this PC's second HDMI).
Everything runs free and local on the RTX 5070 (12 GB). Finished spots live in the git-ignored
`data/commercials/<id>/` and are never posted anywhere.

## Making a spot

1. Write a spec like `pappy-skillet.json`: 15-30 s, a picture prompt, a line and a caption per scene
   (`|` puts a second, smaller caption line under the first), and a camera move (`in`, `out`, `pan`).
2. Pictures: `~/tts/.venv/bin/python scripts/commercials/make_images.py <spec> data/commercials/<id>`
   (three takes per scene; set `"take": 2` on a scene to use another).
3. Voice: `~/tts/.venv/bin/python scripts/commercials/make_voice.py <spec> data/commercials/<id> [reference.wav]`.
   Without a reference it uses Chatterbox's built-in voice, pitched by `voice.pitch` in the spec.
4. Stitch: `node scripts/commercials/build.mjs <spec> data/commercials/<id>` makes `<id>.mp4`
   (1920x1080, 30 fps, captions, the jingle from `music.mjs`, loudness-normalized, VHS grain).

The GPU steps run one at a time; don't start one while the cook voice or a voice-design run is busy.

## The plan (tools, all free for private household use)

| Job | Now | Next step up | License |
|---|---|---|---|
| Stills | SDXL-Turbo (7 GB, ~1 s a picture) | FLUX.1-schnell with CPU offload (~33 GB download, better faces) | SAI community (non-commercial OK) / Apache-2.0 |
| Motion | ffmpeg zoom and pan | Wan 2.2 TI2V-5B image-to-video (fits 12 GB with offload, 5 s clips) or Wan 2.1 T2V-1.3B | Apache-2.0 |
| Voices | Chatterbox, built-in voice pitched down | Chatterbox copying a Qwen3-TTS VoiceDesign clip (designed, never a cloned real person) | MIT / Apache-2.0 |
| Talking faces | none | LatentSync or MuseTalk lip-sync on a cartoon Pappy | Apache-2.0 / MIT |
| Music | our own synth jingle (`music.mjs`) | ACE-Step for full songs | ours / Apache-2.0 |
| Editing | ffmpeg | same | LGPL/GPL |

Re-check each model's license page before downloading it.

## The ten spots

1. **Pappy's Kitchen** (80s infomercial): Pappy Skillet's cast-iron suppers. *Sample made.*
2. **Thy Smoke Shack** (epic trailer): the 2027 shack on The Land, "coming soon".
3. **Wolf Hall Express Delivery** (infomercial): Jake's rides and runs.
4. **Taylor's 5 AM Grind** (trailer): Seraph versus the alarm clock.
5. **NEO's Command Center** (Matrix trailer): Horace and the app.
6. **The Dogs of Wolf Hall** (trailer): Leia and Snowball.
7. **Luke: Nine Lives** (infomercial): the cat who owns the place.
8. **Bonfire Night at The Land** (infomercial): the pit out back by the pond.
9. **Kai's Big Weekend** (trailer).
10. **The Hall Sisters** (trailer): Tatiyana and Katana.

Spots with the kids wait for Horace's OK on how they appear (cartoon or photo).
