# The app's copied voices (Wolf Hall v274+): reads Cook mode / Workshop Oracle lines with Chatterbox (Resemble AI,
# MIT license), copying the voice from a short sample someone in the house recorded (with their OK). Runs on the GPU.
#
# Started once by server/cookvoice.js with ~/tts/.venv/bin/python; the model stays loaded. Reads one JSON
# request per line on stdin: {"text", "voice": "/path/to/sample", "out": "/path/to/out.wav", "exaggeration"?,
# "cfg"?, "speed"?} and answers one JSON line on stdout: {"ok": true, "out": ...} or {"ok": false, "error": ...}.
import json
import os
import sys

import numpy as np
import soundfile as sf
import torch
from chatterbox.tts import ChatterboxTTS

SR = 24000


def decode(src):
    """Any phone/PC recording (m4a, webm, wav...) -> mono float32 at 24 kHz. PyAV, no system ffmpeg needed."""
    import av
    frames = []
    with av.open(src) as c:
        res = av.AudioResampler(format='s16', layout='mono', rate=SR)
        for fr in c.decode(audio=0):
            for r in res.resample(fr):
                frames.append(r.to_ndarray().reshape(-1))
        for r in res.resample(None):
            frames.append(r.to_ndarray().reshape(-1))
    return np.concatenate(frames).astype('float32') / 32768.0


def clean_sample(src):
    """The copy also copies the room, so clean the sample once: cut rumble, reduce background noise and room tail,
    trim the silences, and even out the level. Cached next to the sample as <sample>.clean.wav."""
    out = src + '.clean.wav'
    if os.path.exists(out):
        return out
    import noisereduce as nr
    from scipy.signal import butter, sosfilt
    y = decode(src)
    y = sosfilt(butter(4, 80, 'highpass', fs=SR, output='sos'), y).astype('float32')   # rumble
    y = nr.reduce_noise(y=y, sr=SR, stationary=False, prop_decrease=0.85).astype('float32')
    # trim long silences (keeps short pauses so the rhythm stays natural)
    import librosa
    parts = librosa.effects.split(y, top_db=35, frame_length=1024, hop_length=256)
    if len(parts):
        gap = np.zeros(int(0.12 * SR), dtype='float32')
        y = np.concatenate([np.concatenate([y[a:b], gap]) for a, b in parts])
    y = y / (np.max(np.abs(y)) + 1e-6) * 0.9
    sf.write(out, y, SR)
    return out


def burp(sr, seed=0):
    """A made-on-the-spot burp: a low, wobbly pulse train (55-85 Hz) through a throaty filter, fast attack, slow fade."""
    from scipy.signal import butter, sosfilt
    rng = np.random.default_rng(seed)
    dur = 0.45 + 0.25 * rng.random()
    n = int(dur * sr)
    t = np.arange(n) / sr
    f0 = 85 - 30 * (t / dur) + 6 * np.sin(2 * np.pi * 7 * t) + rng.normal(0, 3, n)   # falling, wobbly pitch
    phase = np.cumsum(f0 / sr)
    pulses = (np.mod(phase, 1.0) < 0.12).astype('float32') + 0.25 * rng.normal(0, 1, n).astype('float32')
    y = sosfilt(butter(2, [180, 900], 'bandpass', fs=sr, output='sos'), pulses)
    env = np.minimum(1, t / 0.03) * np.exp(-2.8 * t / dur)
    y = (y * env).astype('float32')
    return (y / (np.max(np.abs(y)) + 1e-6) * 0.75).astype('float32')


def add_rasp(audio, sr, rasp):
    """Gravel in the voice: breathy noise that follows the voice's loudness, plus a little soft saturation."""
    if rasp <= 0:
        return audio
    from scipy.signal import butter, sosfilt
    env = sosfilt(butter(2, 30, 'lowpass', fs=sr, output='sos'), np.abs(audio))
    noise = sosfilt(butter(2, [900, 4500], 'bandpass', fs=sr, output='sos'), np.random.default_rng(1).normal(0, 1, len(audio)))
    y = audio + rasp * 0.9 * noise * env
    drive = 1 + 3 * rasp
    return (np.tanh(y * drive) / np.tanh(drive)).astype('float32')


def polish(audio, sr, speed, pitch=0.0):
    """Faster talk without the robot sound (WSOLA, made for speech), an optional deeper/higher voice, a little
    cleanup, and a steady level. pitch is in semitones (-2 = a bit deeper): the audio is resampled (which moves
    pitch and length together), then WSOLA puts the length back, so the voice gets deeper without sounding robotic."""
    if abs(pitch) > 0.05:
        from scipy.signal import resample
        f = 2 ** (-pitch / 12.0)                       # >1 for deeper: more samples played at the same rate
        audio = resample(audio, int(len(audio) * f)).astype('float32')
        speed = speed * f                              # WSOLA below restores the original length (times speed)
    if abs(speed - 1.0) > 0.01:
        from audiotsm import wsola
        from audiotsm.io.array import ArrayReader, ArrayWriter
        reader = ArrayReader(audio.reshape(1, -1))
        writer = ArrayWriter(channels=1)
        wsola(channels=1, speed=speed, frame_length=1024, synthesis_hop=256).run(reader, writer)
        audio = writer.data.reshape(-1).astype('float32')
    from scipy.signal import butter, sosfilt
    audio = sosfilt(butter(2, 70, 'highpass', fs=sr, output='sos'), audio).astype('float32')
    return (audio / (np.max(np.abs(audio)) + 1e-6) * 0.89).astype('float32')


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
            voice = clean_sample(req['voice'])
            # exaggeration = how dramatic; a higher cfg keeps the pace brisk and closer to the text.
            # "[burp]" in the text splits it: each piece is spoken, with a made burp in between.
            pieces = [p.strip() for p in str(req['text']).split('[burp]')]
            out_parts = []
            for i, piece in enumerate(pieces):
                if piece:
                    wav = model.generate(piece, audio_prompt_path=voice, exaggeration=float(req.get('exaggeration', 0.6)), cfg_weight=float(req.get('cfg', 0.4)))
                    out_parts.append(polish(wav.squeeze(0).cpu().numpy(), model.sr, float(req.get('speed', 1.0)), float(req.get('pitch', 0.0))))
                if i < len(pieces) - 1:
                    out_parts += [np.zeros(int(0.08 * model.sr), 'float32'), burp(model.sr, seed=i), np.zeros(int(0.12 * model.sr), 'float32')]
            audio = add_rasp(np.concatenate(out_parts), model.sr, float(req.get('rasp', 0.0)))
            sf.write(req['out'], audio, model.sr, subtype='PCM_16')
            print(json.dumps({'ok': True, 'out': req['out']}), file=proto, flush=True)
        except Exception as e:  # one bad line never stops the reader
            print(json.dumps({'ok': False, 'error': str(e)[:300]}), file=proto, flush=True)


if __name__ == '__main__':
    main()
