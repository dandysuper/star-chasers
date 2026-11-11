"""Install the Grok Bot art-overhaul zips (unpacked to /tmp/ao/t1..t3).

Writes public/assets/overhaul/:
  bg/*.webp       backdrops, resized to what a 1280x720 canvas shows
                  (flight ones 1440x810: they are drawn 8 % oversize)
  pages/*.png     flat, procedural art packed into power-of-two pages
  pages/*.webp    painted art packed into power-of-two pages
  manifest.json   {"images": [backdrops], "pages": [{file, tex, frames: [...]}]}

Each frame entry names the atlas texture and frame it replaces, so the game
only has to re-point frames at boot. Stretchable UI (buttons, panel, dialog)
is cut down to its caps plus a 32 px strip of its flat middle, and its slice
insets are stored in the manifest. Nothing from the zips is executed.

python3 work/install-overhaul.py [src_dir]
"""
import glob
import json
import os
import shutil
import sys

import numpy as np
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else '/tmp/ao'
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'public', 'assets'))
DST = os.path.join(ROOT, 'overhaul')

BG_SIZE = {'flight_earth': (1440, 810), 'flight_space': (1440, 810), 'flight_moon': (1440, 810)}
LOGO_SIZE = (784, 396)
PAGE_MAX = 2048
GAP = 16          # between images, so small mip levels do not bleed
MIDDLE = 32       # flat middle kept of a stretchable frame
STRETCH = ('ui/btn_', 'ui/panel_big', 'v2/ui_dialog')
PAINTED_V2 = {'tower', 'habitat', 'control', 'tanks', 'dish', 'airlock', 'board',
              'crate_a', 'crate_b', 'crate_c', 'pad_clamp'}
RENAME = {
    'parts/fins': ('ui', 'fins_red'),
    'parts/parachute': ('ui', 'fx_chute'),
    'parts/bell_spark': ('v2', 'bell_spark'),
    'parts/bell_bull': ('v2', 'bell_bull'),
    'parts/bell_whisper': ('v2', 'bell_whisper'),
    'ui/logo_en': ('ui', 'logo'),
}
ATLASES = ['machines', 'minions', 'resources', 'tools_v2', 'terrain', 'terrain_v2']


def frame_names(path):
    d = json.load(open(path))
    fr = d.get('frames', {})
    return set(fr) if isinstance(fr, dict) else {f['filename'] for f in fr}


NAMES = {'ui': frame_names(os.path.join(ROOT, 'ui', 'ui.json')),
         'v2': frame_names(os.path.join(ROOT, 'v2', 'v2.json'))}
for a in ATLASES:
    NAMES[a] = frame_names(os.path.join(ROOT, 'atlases', a + '.json'))


def target(key):
    """(texture, frame) a key lands in; 'overhaul' for keys with no frame today."""
    if key in RENAME:
        return RENAME[key]
    group, name = key.split('/', 1)
    if group in ('parts', 'ui'):
        return 'ui', name
    if group == 'v2':
        return 'v2', name
    if group == 'ground':
        return ('v2', name) if name in NAMES['v2'] else ('overhaul', name)
    if group == 'atlases':
        for a in ATLASES:
            if name in NAMES[a]:
                return a, name
        return None
    if group == 'explore':
        return 'overhaul', name
    return None


def painted(key):
    group, name = key.split('/', 1)
    return (group in ('atlases', 'explore')
            or key in ('ground/ground_moon', 'ground/ground_mars', 'ground/ground_mars_rock')
            or name.startswith('ui_portrait_') or name.startswith('logo_')
            or (group == 'v2' and name in PAINTED_V2))


def longest_run(same, n):
    best, start = (0, 0), 0
    for i in range(1, n):
        if not same(i):
            start = i
        if i - start > best[1] - best[0]:
            best = (start, i)
    return best


def compact(img):
    """Caps plus a MIDDLE strip of the flat middle, and the slice insets."""
    a = np.array(img)
    h, w = a.shape[:2]
    c0, c1 = longest_run(lambda i: np.array_equal(a[:, i], a[:, i - 1]), w)
    r0, r1 = longest_run(lambda j: np.array_equal(a[j], a[j - 1]), h)
    sl = {'l': c0, 'r': w - 1 - c1, 't': r0, 'b': h - 1 - r1, 'w0': w, 'h0': h}
    mid_w = min(MIDDLE, w - sl['l'] - sl['r'])
    mid_h = MIDDLE if h - sl['t'] - sl['b'] >= MIDDLE * 2 else h - sl['t'] - sl['b']
    cols = list(range(sl['l'])) + [c0] * mid_w + list(range(w - sl['r'], w))
    rows = list(range(sl['t'])) + [r0] * mid_h + list(range(h - sl['b'], h))
    return Image.fromarray(a[np.ix_(rows, cols)]), sl


def pot(n):
    p = 1
    while p < n:
        p <<= 1
    return p


def pack(items):
    """Shelf-pack (key, img, ...) into power-of-two pages."""
    items = sorted(items, key=lambda it: (-it['img'].height, -it['img'].width))
    area = sum((it['img'].width + GAP) * (it['img'].height + GAP) for it in items)
    widest = max(it['img'].width + GAP for it in items)
    page_w = min(PAGE_MAX, max(pot(widest), pot(int((area * 1.15) ** 0.5))))
    pages, cur = [], []
    x = y = shelf = 0
    for it in items:
        w, h = it['img'].size
        if x + w > page_w:
            x, y, shelf = 0, y + shelf + GAP, 0
        if y + h > PAGE_MAX:
            pages.append(cur)
            cur, x, y, shelf = [], 0, 0, 0
        cur.append((it, x, y))
        shelf = max(shelf, h)
        x += -(-(w + GAP) // 8) * 8        # keep frames on an 8 px grid
    pages.append(cur)
    out = []
    for placed in pages:
        page_h = pot(max(py + it['img'].height for it, _, py in placed))
        out.append((page_w, page_h, placed))
    return out


# ---- collect ---------------------------------------------------------------
shutil.rmtree(DST, ignore_errors=True)
os.makedirs(os.path.join(DST, 'bg'))
os.makedirs(os.path.join(DST, 'pages'))
backdrops, items, seen = [], [], set()
for tier in ('t1', 't2', 't3'):
    root = os.path.join(SRC, tier, 'public', 'assets', 'overhaul')
    for e in json.load(open(os.path.join(root, 'manifest.json')))['images']:
        key, rel = e['key'], e['file']
        assert key not in seen, f'duplicate key {key}'
        seen.add(key)
        src = os.path.join(root, rel)
        if key.startswith('bg/'):
            size = BG_SIZE.get(key[3:], (1280, 720))
            Image.open(src).convert('RGB').resize(size, Image.LANCZOS).save(
                os.path.join(DST, rel), 'WEBP', quality=85, method=6)
            backdrops.append({'key': key, 'file': rel})
            continue
        dest = target(key)
        if not dest:
            print('skipped (nothing to replace):', key)
            continue
        img = Image.open(src).convert('RGBA')
        if key in ('ui/logo_en', 'ui/logo_ru'):
            img = img.resize(LOGO_SIZE, Image.LANCZOS)
        it = {'key': key, 'img': img, 'tex': dest[0], 'frame': dest[1], 'slice': None}
        if key.startswith(STRETCH):
            it['img'], it['slice'] = compact(img)
        items.append(it)

# Derived, not delivered: an all-empty plaque for a 0-star result. The plaque
# is symmetric, and slot 3 of stars_1 is empty, so slot 1 gets slot 3 mirrored.
s1 = next(it for it in items if it['key'] == 'ui/stars_1')['img']
x0, x1, y0, y1 = 404, 520, 54, 168
s0 = s1.copy()
s0.paste(s1.crop((x0, y0, x1, y1)).transpose(Image.FLIP_LEFT_RIGHT), (s1.width - x1, y0))
items.append({'key': 'ui/stars_0', 'img': s0, 'tex': 'ui', 'frame': 'stars_0', 'slice': None})

# ---- pack ------------------------------------------------------------------
# Three sets: keys with no frame today get a texture of their own ('overhaul');
# the rest share pages that are spliced into every atlas they replace frames in.
groups = {
    ('overhaul', 'webp'): [it for it in items if it['tex'] == 'overhaul'],
    ('shared', 'webp'): [it for it in items if it['tex'] != 'overhaul' and painted(it['key'])],
    ('shared', 'png'): [it for it in items if it['tex'] != 'overhaul' and not painted(it['key'])],
}
pages = []
for (kind, fmt), group in groups.items():
    if not group:
        continue
    packed = pack(group)
    assert kind != 'overhaul' or len(packed) == 1, 'the overhaul texture must fit one page'
    for pw, ph, placed in packed:
        name = f'pages/{kind}_{len(pages)}.{fmt}'
        canvas = Image.new('RGBA', (pw, ph), (0, 0, 0, 0))
        frames = []
        for it, x, y in placed:
            canvas.paste(it['img'], (x, y))
            f = {'key': it['key'], 'tex': it['tex'], 'frame': it['frame'],
                 'x': x, 'y': y, 'w': it['img'].width, 'h': it['img'].height}
            if it['slice']:
                f['slice'] = it['slice']
            frames.append(f)
        path = os.path.join(DST, name)
        if fmt == 'webp':
            canvas.save(path, 'WEBP', quality=88, method=6)
        else:
            canvas.save(path, optimize=True)
        pages.append({'file': name, 'tex': 'overhaul' if kind == 'overhaul' else None,
                      'w': pw, 'h': ph, 'frames': frames})
        print(f'{name}: {pw}x{ph}, {len(frames)} frames, {os.path.getsize(path) // 1024} KB')

json.dump({'images': backdrops, 'pages': pages}, open(os.path.join(DST, 'manifest.json'), 'w'), indent=1)
total = sum(os.path.getsize(p) for p in glob.glob(os.path.join(DST, '**', '*'), recursive=True) if os.path.isfile(p))
print(f'{len(items)} frames in {len(pages)} pages + {len(backdrops)} backdrops, {total // 1024} KB total')
