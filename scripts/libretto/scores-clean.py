"""Crops scanned score pages for the reader: scanner borders cut away, the page itself left in its own colours.

  /opt/anaconda3/bin/python scripts/libretto/scores-clean.py <in dir> <out dir> [glob, default *.jpg] [--wash]

--wash also turns the page black and white with the paper washed to white. Without it only the crop is applied.

Per page: find the paper (the longest bright run of columns and of rows, so dark scanner bars and a neighbouring page
beyond the gutter are left out), flatten uneven yellowing by dividing by a local paper estimate, stretch the levels so
paper is white and ink is black, then trim to the ink with a small margin.
"""
import glob, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

src, dst = sys.argv[1], sys.argv[2]
args = [a for a in sys.argv[3:] if not a.startswith('--')]
WASH = '--wash' in sys.argv
pat = args[0] if args else '*.jpg'
os.makedirs(dst, exist_ok=True)


def longest_run(mask):
    best, start, cur = (0, 0), None, 0
    for i, v in enumerate(list(mask) + [False]):
        if v and start is None:
            start = i
        elif not v and start is not None:
            if i - start > best[1] - best[0]:
                best = (start, i)
            start = None
    return best


def clean(path):
    im = Image.open(path).convert('RGB')
    g = np.asarray(im.convert('L'), dtype=np.float32)
    h, w = g.shape
    bright = g > 0.62 * np.percentile(g, 92)
    x0, x1 = longest_run(bright.mean(axis=0) > 0.55)
    y0, y1 = longest_run(bright.mean(axis=1) > 0.55)
    if x1 - x0 < w * 0.4 or y1 - y0 < h * 0.4:
        x0, x1, y0, y1 = 0, w, 0, h
    # the paper's edge curls into shadow: stay well inside it (margins around the music are wider than this)
    ix, iy = int((x1 - x0) * 0.035), int((y1 - y0) * 0.03)
    ox, oy = x0 + ix, y0 + iy
    g = g[oy : y1 - iy, ox : x1 - ix]
    # local paper brightness: the biggest values nearby, smoothed; ink is thinner than the window
    bg = ndi.gaussian_filter(ndi.maximum_filter(ndi.zoom(g, 0.25, order=1), size=9), 3)
    bg = ndi.zoom(bg, (g.shape[0] / bg.shape[0], g.shape[1] / bg.shape[1]), order=1)
    out = np.clip(g / np.maximum(bg, 1), 0, 1)
    out = np.clip((out - 0.50) / (0.88 - 0.50), 0, 1)
    # scanner shadow that survived the crop is dark and touches the edge; the music never does
    lab, n = ndi.label(out < 0.5)
    if n:
        edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
        edge = edge[edge > 0]
        if len(edge):
            shadow = ndi.binary_dilation(np.isin(lab, edge), iterations=4)
            out = np.where(shadow, 1.0, out)
    ink = out < 0.5
    cols = np.where(ink.sum(axis=0) >= 3)[0]
    rows = np.where(ink.sum(axis=1) >= 3)[0]
    m = 14
    if len(cols) and len(rows):
        top, bottom, left, right = max(rows[0] - m, 0), rows[-1] + m, max(cols[0] - m, 0), cols[-1] + m
    else:
        top, bottom, left, right = 0, g.shape[0], 0, g.shape[1]
    name = os.path.join(dst, os.path.basename(path))
    if WASH:
        Image.fromarray((out[top:bottom, left:right] * 255).astype(np.uint8)).save(name, quality=62, optimize=True)
    else:
        im.crop((ox + left, oy + top, ox + right, oy + bottom)).save(name, quality=62, optimize=True)


for p in sorted(glob.glob(os.path.join(src, pat))):
    clean(p)
