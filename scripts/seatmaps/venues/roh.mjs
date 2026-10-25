// Royal Opera House, Main Stage: the "Select your own seat" map at rbo.org.uk/seatmap?performanceId=<id>
// (production page → date → Buy tickets → Use our seatmap). The map is a static Illustrator SVG whose seat circles are
// named seat-<number>-<row>-<screen>; the Tessitura seat list (through the site's public v2-proxy) gives each seat's
// section. Both are public, so they're fetched directly; a fresh performanceId works if 74505 has gone.
import { fetchCached, writePlan } from '../lib.mjs';

const BASE = 'https://www.rbo.org.uk';
const PERF = 74505;
const SVG_URL = `${BASE}/seatmap/assets/roh-seatmap-original--sections-v3-access-patched.svg`;
const SEATS_URL = `${BASE}/api/v2-proxy/TXN/Performances/${PERF}/Seats?constituentId=0&modeOfSaleId=9&performanceId=${PERF}`;
const SECTIONS_URL = `${BASE}/api/v2-proxy/ReferenceData/Sections`;

const svg = await fetchCached('roh.seatmap.svg', SVG_URL);
const seats = JSON.parse(await fetchCached('roh.seats.json', SEATS_URL));
const sectionName = new Map(JSON.parse(await fetchCached('roh.sections.json', SECTIONS_URL)).map((s) => [s.Id, s.Description]));

const key = (number, row, screen) => `${number}-${row.replace(/ /g, '_')}-${screen}`;
const tess = new Map(seats.map((s) => [key(s.SeatNumber.trim(), s.SeatRow.trim(), s.ScreenId), s]));

// SVG level groups → the venue's level names.
const LEVEL = {
  'Orchestra-Stalls': 'Orchestra Stalls',
  'Stalls-Circle': 'Stalls Circle',
  'Grand-Tier': 'Grand Tier',
  Balcony: 'Balcony',
  Amphitheatre: 'Amphitheatre',
};
const GEOMETRY = {
  'Orchestra Stalls': { height: 0, rake: 0.07, front: 6 },
  'Stalls Circle': { height: 3.6, rake: 0.3, front: 16, wrap: 10.5 },
  'Grand Tier': { height: 7.2, rake: 0.35, front: 17, wrap: 10.5 },
  Balcony: { height: 10.8, rake: 0.4, front: 18.5, wrap: 11 },
  Amphitheatre: { height: 14.4, rake: 0.55, front: 20, wrap: 15.5 },
};

// "LEVEL 3  Balcony Boxes 3D" → section; boxes and wheelchair spaces get their own sections.
const sectionOf = (desc, row) => {
  if (/box/i.test(row)) return 'Boxes';
  const name = desc.replace(/^LEVEL \w+\s+/, '').replace(/\s+[A-Z\d]{1,2}$/, '');
  if (/ WC/.test(name)) return 'Wheelchair spaces';
  if (/Upper Amphitheatre/.test(name)) return 'Amphitheatre';
  return name;
};
const boxName = (row) => ({ 'BOX RB': 'Royal Box', 'BOX BB': 'Bedford Box' })[row] ?? row.replace(/^BOX[ _]/, 'Box ');

const levels = new Map();
const stack = [];
for (const m of svg.matchAll(/<(\/?)(g|circle|ellipse)\b([^>]*?)\/?>/g)) {
  const [, close, tag, attrs] = m;
  if (tag === 'g') {
    if (close) stack.pop();
    else stack.push(/id="([^"]*)"/.exec(attrs)?.[1]);
    continue;
  }
  const id = /id="seat-(\d+)-(.+)-(\d)(?:_\w*_)?"/.exec(attrs);
  if (!id) continue;
  const levelName = LEVEL[stack.find((g) => LEVEL[g])];
  const [, number, svgRow, screen] = id;
  const t = tess.get(key(number, svgRow.replace(/_/g, ' '), +screen));
  const row = t ? t.SeatRow.trim() : svgRow.replace(/_/g, ' ');
  const section = t ? sectionOf(sectionName.get(t.SectionId) ?? '', row) : /BOX/.test(row) ? 'Boxes' : levelName;
  // Rotated ellipses carry a matrix(a b c d e f) transform.
  let x = +/cx="([-\d.]+)"/.exec(attrs)[1], y = +/cy="([-\d.]+)"/.exec(attrs)[1];
  const tf = /matrix\(([^)]*)\)/.exec(attrs);
  if (tf) {
    const [a, b, c, d, e, f] = tf[1].trim().split(/[\s,]+/).map(Number);
    [x, y] = [a * x + c * y + e, b * x + d * y + f];
  }
  // The SVG has the stage at the bottom, drawn from the stage's side: turn it 180° so the stage is at the top.
  const level = levels.get(levelName) ?? new Map();
  levels.set(levelName, level);
  const sec = level.get(section) ?? new Map();
  level.set(section, sec);
  const rowName = section === 'Boxes' ? boxName(row) : row;
  const r = sec.get(rowName) ?? [];
  sec.set(rowName, r);
  r.push([number, -x, -y]);
}

// Slips run down both sides: split them into Left / Right (house left is plan left).
for (const level of levels.values()) {
  for (const name of ['Lower Slips', 'Upper Slips']) {
    const sec = level.get(name);
    if (!sec) continue;
    level.delete(name);
    for (const side of ['Left', 'Right']) {
      const rows = new Map([...sec].map(([row, s]) => [row, s.filter(([, x]) => (x < -975.6) === (side === 'Left'))]));
      level.set(`${name} ${side}`, rows);
    }
  }
}

await writePlan({
  id: 'roh',
  name: 'Royal Opera House',
  hall: 'Main Stage',
  venueNames: ['Royal Opera House'],
  mapVenueIds: ['roh'],
  halls: ['Main Stage'],
  source: { system: 'Tessitura', url: `${BASE}/seatmap?performanceId=${PERF}`, captured: '2026-10-24', method: 'extracted' },
  stage: { type: 'proscenium', width: 12.2, depth: 26, pit: 5 },
  levels: Object.values(LEVEL).filter((n) => levels.has(n)).map((name) => ({
    name,
    ...GEOMETRY[name],
    sections: [...levels.get(name)].map(([section, rows]) => ({
      name: section,
      // The map draws the Lower Slips in the Amphitheatre panel; in the house they run a floor below the Upper Slips.
      ...(section.startsWith('Lower Slips') ? { lift: -3.6 } : {}),
      rows: [...rows].map(([row, s]) => ({ row, seats: s })),
    })),
  })),
});
