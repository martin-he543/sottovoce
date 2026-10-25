/**
 * Rebuilds every seating plan in public/seatmaps/ and its index from scripts/seatmaps/venues/*.mjs.
 *
 *   node scripts/seatmaps/run.mjs            # all venues
 *   node scripts/seatmaps/run.mjs roh rah    # just these
 */
import { execFileSync } from 'node:child_process';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { OUT_DIR, ROOT } from './lib.mjs';

const dir = join(ROOT, 'scripts', 'seatmaps', 'venues');
const only = process.argv.slice(2);
const venues = (await readdir(dir)).filter((f) => f.endsWith('.mjs')).map((f) => f.slice(0, -4)).filter((id) => !only.length || only.includes(id));
if (!only.length) await rm(join(OUT_DIR, 'index.json'), { force: true });
for (const id of venues) execFileSync(process.execPath, [join(dir, `${id}.mjs`)], { stdio: 'inherit' });
