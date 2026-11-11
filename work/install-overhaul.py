"""Install the Grok Bot art-overhaul zips (already unpacked to /tmp/ao/t1..t3).

Copies only public/assets/overhaul/ from each tier, merges the three manifests
into one, and resizes the files that were delivered far above what a
1280x720 canvas can show:
  - bg/*.webp: 2560x1440 -> 1280x720 (flight_* -> 1440x810, they overscan 8 %)
  - ui/logo_*.png: 1536x776 -> 784x396 (shown at 392x198)
Everything else is copied byte-for-byte. Nothing from the zips is executed.
"""
import json
import os
import shutil
import sys

from PIL import Image

SRC = '/tmp/ao'
DST = os.path.join(os.path.dirname(__file__), '..', 'public', 'assets', 'overhaul')
DST = os.path.abspath(DST)

BG_SIZE = {'flight_earth': (1440, 810), 'flight_space': (1440, 810), 'flight_moon': (1440, 810)}
LOGO_SIZE = (784, 396)

os.makedirs(DST, exist_ok=True)
entries = []
seen = set()
for tier in ('t1', 't2', 't3'):
    root = os.path.join(SRC, tier, 'public', 'assets', 'overhaul')
    manifest = json.load(open(os.path.join(root, 'manifest.json')))
    for e in manifest['images']:
        key, rel = e['key'], e['file']
        if key in seen:
            sys.exit(f'duplicate key {key}')
        seen.add(key)
        src = os.path.join(root, rel)
        dst = os.path.join(DST, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        group, name = key.split('/', 1)
        if group == 'bg':
            size = BG_SIZE.get(name, (1280, 720))
            Image.open(src).convert('RGB').resize(size, Image.LANCZOS).save(dst, 'WEBP', quality=85, method=6)
        elif key in ('ui/logo_en', 'ui/logo_ru'):
            Image.open(src).convert('RGBA').resize(LOGO_SIZE, Image.LANCZOS).save(dst, optimize=True)
        else:
            shutil.copyfile(src, dst)
        entries.append({'key': key, 'file': rel})

# Derived, not delivered: an all-empty plaque for a 0-star result. The plaque
# is symmetric about its centre and slot 3 of stars_1 is empty, so slot 1 is
# covered with slot 3 mirrored. Today the game dims stars_1 for 0 stars,
# which with this art still reads as one gold star.
s1_path = os.path.join(DST, 'ui', 'stars_1.png')
if os.path.exists(s1_path):
    s1 = Image.open(s1_path).convert('RGBA')
    w, h = s1.size
    x0, x1, y0, y1 = 404, 520, 54, 168          # slot 3 (empty), with a margin
    patch = s1.crop((x0, y0, x1, y1)).transpose(Image.FLIP_LEFT_RIGHT)
    s0 = s1.copy()
    s0.paste(patch, (w - x1, y0))
    s0.save(os.path.join(DST, 'ui', 'stars_0.png'), optimize=True)
    entries.append({'key': 'ui/stars_0', 'file': 'ui/stars_0.png'})

json.dump({'images': entries}, open(os.path.join(DST, 'manifest.json'), 'w'), indent=2)
missing = [e['file'] for e in entries if not os.path.exists(os.path.join(DST, e['file']))]
print(f'installed {len(entries)} files into {DST}; missing: {missing}')
