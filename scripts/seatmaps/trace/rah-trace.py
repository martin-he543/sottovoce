"""
Royal Albert Hall: turns a screenshot of the booking seat map (one dot per seat, stage at the top) into
rah.rows.json: every seat's position, grouped into tier > block > row and numbered.

The RAH booking site (royalalberthall.com) sits behind an Imperva bot wall, so there is no seat data to extract; the map
is traced from a screenshot instead. Seats are found as dots (grey = not on sale, colours = on sale), then:
  * Arena (ringside), Stalls, Boxes and Circle are told apart by how the dots cluster;
  * Stalls rows (1-11) and Circle rows (1-7) are the concentric rings, counted from the inner / outer edge;
  * blocks (G1…O1 stalls, P1…Y2 circle) are cut by angle round the hall, using the hall's published seating plan;
  * boxes are the small clusters; their tier is told by size (12 seats Grand Tier, 5 Second Tier, 8 Loggia);
  * seats are numbered left to right as you face the stage, boxes in order round the hall.
The printed row and box numbers on the map are too small to read, so those numbers follow this order rather than
being copied off the map.

    python3 -m venv /tmp/v && /tmp/v/bin/pip install pillow numpy scipy
    /tmp/v/bin/python scripts/seatmaps/trace/rah-trace.py screenshot.png scripts/seatmaps/trace/rah.rows.json
"""
import json, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree

# ---------- 1. find the dots ----------
im = np.array(Image.open(sys.argv[1]).convert('RGB')).astype(int)
mx, mn = im.max(2), im.min(2)
sat = mx - mn
grey = (mn > 205) & (mx < 246) & (sat < 12)   # not on sale
col = (sat >= 40) & (mx > 90)                 # on sale, by price band
mask = ndi.binary_opening(grey | col, structure=np.ones((3, 3)))
dt = ndi.distance_transform_edt(mask)
peaks = (dt == ndi.maximum_filter(dt, size=7)) & (dt >= 3.0)
lab, n = ndi.label(peaks)
X = np.array(ndi.center_of_mass(peaks, lab, range(1, n + 1)))[:, ::-1]
X = X[~(((X[:, 0] > 1880) & (X[:, 1] < 320)) | (X[:, 1] < 25))]   # zoom buttons, link underline
n = len(X)

def comps(idx, radius):
    pr = cKDTree(X[idx]).query_pairs(radius, output_type='ndarray')
    g = coo_matrix((np.ones(len(pr)), (pr[:, 0], pr[:, 1])), shape=(len(idx), len(idx)))
    k, l = connected_components(g, directed=False)
    return [idx[l == i] for i in range(k)]

def aspect(q):
    if len(q) < 3: return 99.0
    w = np.linalg.eigvalsh(np.cov(q.T))
    return float(np.sqrt(w[1] / max(w[0], 1e-6)))

# ---------- 2. which tier ----------
C = np.array([1050.0, 1030.0])      # rough middle, for telling the tiers apart
H = np.array([1050.0, 964.0])       # the hall's middle: where the aisle between the side and end blocks crosses
STAGE = np.array([1050.0, 1050.0])  # front of the stage extension
tier = np.array([''] * n, dtype=object)
for c in comps(np.arange(n), 27):
    q = X[c]; m = q.mean(0); rr = np.hypot(*(q - C).T)
    if len(q) < 100 and rr.mean() < 330: tier[c] = 'arena'
    elif 790 < m[0] < 1310 and 800 < m[1] < 1300: tier[c] = 'arena'
    elif len(q) >= 100 and aspect(q) < 3 and rr.max() < 660: tier[c] = 'stalls'
    elif rr.max() < 720 and len(q) <= 140 and (aspect(q) < 8 or len(q) <= 30): tier[c] = 'box'
    else: tier[c] = 'circle'
# Box clusters (2 x 4, 3 x 4, 5 seats) split apart at seat pitch; anything else that looked like a box is circle.
boxes = []
for c in comps(np.where((tier == 'box') | (tier == 'circle'))[0], 17.5):
    if 4 <= len(c) <= 14 and aspect(X[c]) < 3.2: boxes.append(c)
inbox = np.zeros(n, bool)
for c in boxes: inbox[c] = True
tier[(tier == 'box') & ~inbox] = 'circle'
tier[inbox] = 'box'

# Angle round the hall, 60..300 (stage at 0): a seat's number grows with -angle, i.e. left to right facing the stage.
def theta(p):
    d = p - H
    return np.degrees(np.arctan2(d[..., 0], -d[..., 1])) % 360

def pick(bounds, t):
    for name, lo in bounds:
        if t >= lo: return name
    return bounds[-1][0]

STALL_BLOCKS = [('G1', 287), ('H1', 270), ('H2', 251), ('J1', 232), ('J2', 208), ('K1', 180), ('K2', 152), ('L1', 128), ('L2', 109), ('M2', 90), ('M1', 73), ('O1', 0)]
CIRCLE_BLOCKS = [('P1', 293.3), ('P2', 282), ('Q1', 270), ('Q2', 257), ('R1', 243), ('R2', 230), ('S1', 217), ('S2', 205), ('T1', 192), ('T2', 180),
                 ('U1', 168), ('U2', 155), ('V1', 143), ('V2', 130), ('W1', 117), ('W2', 103), ('X1', 90), ('X2', 78), ('Y1', 66.7), ('Y2', 0)]

def numbered(pts):
    """Seats left to right as you face the stage: [[num, x, y], …]."""
    pts = sorted(pts, key=lambda p: -theta(np.array(p)))
    return [[str(i + 1), round(float(p[0]), 1), round(float(p[1]), 1)] for i, p in enumerate(pts)]

def ring_rows(idx, anchor, step, count, from_outside):
    """Rows of a ringed block as concentric bands: 1-based row number per dot, from the inner or outer edge."""
    q = X[idx]; th = theta(q); r = np.hypot(*(q - H).T)
    bins = (th // 2).astype(int)
    edge = {}
    for b in np.unique(bins):
        near = [r[(abs(bins - k) <= 2)] for k in [b]][0]
        edge[b] = (near.max() if from_outside else near.min())
    # Smooth: the median of the neighbouring bins' edge, so a missing seat doesn't shift a row.
    keys = sorted(edge)
    sm = {b: np.median([edge[k] for k in keys if abs(k - b) <= 2]) for b in keys}
    out = []
    for i in range(len(idx)):
        e = sm[bins[i]]
        k = round((e - r[i]) / step) if from_outside else round((r[i] - e) / step)
        out.append(int(np.clip(count - k if from_outside else 1 + k, 1, count)))
    return out

levels = []

# ---------- Arena (ringside) ----------
arena = {}
for c in comps(np.where(tier == 'arena')[0], 27):
    q = X[c]; m = q.mean(0)
    if len(q) > 150: name = 'Ringside Centre'
    elif abs(m[1] - 1085) < 40: name = 'Ringside East corner' if m[0] < 1050 else 'Ringside West corner'
    elif m[1] > 880: name = 'Ringside East' if m[0] < 1050 else 'Ringside West'
    else: name = 'Ringside East stage end' if m[0] < 1050 else 'Ringside West stage end'
    arena[name] = c
sections = []
for name, c in sorted(arena.items()):
    q = X[c]
    if name == 'Ringside Centre':   # a grid, rows A (stage side) to J
        order = np.argsort(q[:, 1]); ys = q[order, 1]
        rows, cur = [], [order[0]]
        for a, b in zip(order, order[1:]):
            if q[b, 1] - q[cur[-1], 1] > 7: rows.append(cur); cur = []
            cur.append(b)
        rows.append(cur)
        rows = [[(q[i, 0], q[i, 1]) for i in sorted(r, key=lambda i: q[i, 0])] for r in rows]
        sections.append({'name': name, 'rows': [{'row': chr(65 + i), 'seats': [[str(j + 1), round(float(p[0]), 1), round(float(p[1]), 1)] for j, p in enumerate(r)]} for i, r in enumerate(rows)]})
    else:                           # curved rows A, B, … outwards from the stage
        d = np.hypot(*(q - STAGE).T); order = np.argsort(d)
        rows, cur = [], [order[0]]
        for a, b in zip(order, order[1:]):
            if d[b] - d[cur[-1]] > 9: rows.append(cur); cur = []
            cur.append(b)
        rows.append(cur)
        sections.append({'name': name, 'rows': [{'row': chr(65 + i), 'seats': numbered([tuple(q[k]) for k in r])} for i, r in enumerate(rows)]})
levels.append({'name': 'Arena', 'sections': sections})

# ---------- Stalls ----------
idx = np.where(tier == 'stalls')[0]
row_of = ring_rows(idx, None, 23.4, 11, False)
blocks = {}
for i, rw in zip(idx, row_of):
    blocks.setdefault(pick(STALL_BLOCKS, float(theta(X[i]))), {}).setdefault(rw, []).append(tuple(X[i]))
levels.append({'name': 'Stalls', 'sections': [
    {'name': f'Block {b}', 'rows': [{'row': str(r), 'seats': numbered(s)} for r, s in sorted(rows.items())]}
    for b, _ in STALL_BLOCKS for rows in [blocks.get(b)] if rows]})

# ---------- Boxes ----------
tiers = {'Loggia Boxes': [], 'Grand Tier Boxes': [], 'Second Tier Boxes': []}
for c in boxes:
    q = X[c]
    name = 'Grand Tier Boxes' if len(c) >= 10 else 'Second Tier Boxes' if len(c) <= 6 else 'Loggia Boxes' if np.hypot(*(q.mean(0) - C)) < 600 else 'Second Tier Boxes'
    tiers[name].append(q)
for name, bxs in tiers.items():
    bxs.sort(key=lambda q: -float(theta(q.mean(0))))
    rows = []
    for k, q in enumerate(bxs):
        u = q.mean(0) - H; u /= np.hypot(*u)            # outwards
        depth = (q - q.mean(0)) @ u
        order = np.argsort(depth)
        nrows = 3 if len(q) >= 10 else 2 if len(q) >= 6 and aspect(q) < 1.8 else 1 if len(q) <= 5 and aspect(q) > 1.7 else 2
        gaps = np.argsort(-np.diff(depth[order]))[:nrows - 1]
        cuts = sorted(gaps + 1)
        seats = []
        for part in np.split(order, cuts):
            part = sorted(part, key=lambda i: -float(theta(q[i])))
            seats += [tuple(q[i]) for i in part]
        rows.append({'row': f'Box {k + 1}', 'seats': [[str(j + 1), round(float(p[0]), 1), round(float(p[1]), 1)] for j, p in enumerate(seats)]})
    levels.append({'name': name, 'sections': [{'name': 'Boxes', 'rows': rows}]})

# ---------- Circle ----------
idx = np.where(tier == 'circle')[0]
row_of = ring_rows(idx, None, 28.0, 7, True)
blocks = {}
for i, rw in zip(idx, row_of):
    blocks.setdefault(pick(CIRCLE_BLOCKS, float(theta(X[i]))), {}).setdefault(rw, []).append(tuple(X[i]))
levels.append({'name': 'Circle', 'sections': [
    {'name': f'Block {b}', 'rows': [{'row': str(r), 'seats': numbered(s)} for r, s in sorted(rows.items())]}
    for b, _ in CIRCLE_BLOCKS for rows in [blocks.get(b)] if rows]})

json.dump({'levels': levels}, open(sys.argv[2], 'w'), separators=(',', ':'))
for l in levels:
    print(l['name'], sum(len(r['seats']) for s in l['sections'] for r in s['rows']), 'seats,', sum(len(s['rows']) for s in l['sections']), 'rows in', len(l['sections']), 'sections')
