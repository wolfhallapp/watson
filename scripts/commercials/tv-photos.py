# Family photos for the house TV (11/24, Horace: "include photos as well"). Copies the picked originals
# (data/family-photos/picks, already checked for cards, IDs, addresses and screens) into data/commercials/tv-photos at
# TV size, turned the right way up. Only what is in tv-photos ever shows on the TV.
import os
from PIL import Image, ImageOps

ROOT = '/mnt/c/Users/Owner/Documents/watson/data'
SRC, OUT = os.path.join(ROOT, 'family-photos/picks'), os.path.join(ROOT, 'commercials/tv-photos')
os.makedirs(OUT, exist_ok=True)
n = 0
for f in sorted(os.listdir(SRC)):
    if not f.lower().endswith(('.jpg', '.jpeg', '.png')): continue
    name = os.path.splitext(f)[0].lower().replace('_', '-')
    dst = os.path.join(OUT, name + '.jpg')
    if os.path.exists(dst): continue
    im = ImageOps.exif_transpose(Image.open(os.path.join(SRC, f))).convert('RGB')
    im.thumbnail((1920, 1080))
    im.save(dst, quality=88); n += 1
print(n, 'added;', len(os.listdir(OUT)), 'on the TV')
