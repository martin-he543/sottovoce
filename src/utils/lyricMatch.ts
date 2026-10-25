/**
 * Matches what the microphone heard (a speech-recognition transcript of someone singing, so ragged and partial) to the
 * lines of a libretto, to keep the synced text on the right line.
 */

/** Lower-case, accent-free words, so "Vissi d’arte" ≈ "vissi d arte". */
export function lyricTokens(s: string): string[] {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // Ligatures and letters NFD leaves whole: "cœur" must meet a recogniser's "coeur".
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/ß/g, 'ss')
    .replace(/ø/g, 'o')
    .replace(/ł/g, 'l')
    .replace(/[’']/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

/** 1 for the same word, down to 0; a recogniser's near-misses ("arte" / "arté" / "ate") still earn most of it. */
function wordSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 3 || b.length < 3) return 0;
  const sim = 1 - editDistance(a, b) / Math.max(a.length, b.length);
  return sim >= 0.7 ? sim : 0;
}

/** How well `heard` explains `line`, 0–1: a blend of how much of the line was heard and how much of what was heard is in it. */
export function lineScore(heard: string[], line: string[]): number {
  if (!heard.length || !line.length) return 0;
  const free = new Set(line.map((_, i) => i));
  let hit = 0;
  for (const h of heard) {
    let best = 0;
    let at = -1;
    for (const i of free) {
      const s = wordSimilarity(h, line[i]);
      if (s > best) {
        best = s;
        at = i;
      }
    }
    if (at >= 0) {
      hit += best;
      free.delete(at);
    }
  }
  const precision = hit / heard.length;
  const recall = hit / line.length;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  // A transcript is often only the first half of a line, so a clean fragment of 3+ words counts for nearly as much as a full match.
  return Math.max(f1, heard.length >= 3 ? 0.9 * precision * Math.min(1, recall * 2.2) : 0);
}

export interface LineMatch {
  index: number;
  score: number;
}

/** Each libretto's lines as tokens, made once: the microphone matches against them several times a second. */
const tokenCache = new WeakMap<object, string[][]>();
const tokensOf = (lines: { original_text: string }[]) => {
  let t = tokenCache.get(lines);
  if (!t) tokenCache.set(lines, (t = lines.map((l) => lyricTokens(l.original_text))));
  return t;
};

/**
 * The line `heard` is most likely from, or null when nothing matches well enough. Lines at or just after `from` get a
 * small head start (a performance moves forward). A transcript spanning several lines (a few seconds of singing often
 * covers three or four short ones) is matched against runs of up to four lines and credited to the last of them.
 */
export function matchHeard(heard: string, lines: { original_text: string }[], from = 0, minScore = 0.5): LineMatch | null {
  const words = lyricTokens(heard);
  if (words.length < 2) return null;
  const toks = tokensOf(lines);
  let best: LineMatch | null = null;
  const consider = (index: number, raw: number) => {
    // A performance moves forward, and refrains repeat (Carmen's Toreador song, the Habanera's chorus): the same words
    // match many places, so the nearest one ahead wins and the further away a match is, the more it must prove.
    const d = index - from;
    const prior = d >= 0 && d <= 8 ? 0.06 : d < 0 ? -0.04 - Math.min(0.1, -d * 0.004) : -Math.min(0.12, (d - 8) * 0.003);
    const score = raw + (raw > 0 ? prior : 0);
    if (score >= minScore && (!best || score > best.score + 1e-9)) best = { index, score: Math.min(1, score) };
  };
  for (let i = 0; i < lines.length; i++) {
    consider(i, lineScore(words, toks[i]));
    // Longer runs only for longer transcripts: two words can't vouch for four lines.
    let run = toks[i];
    for (let k = 1; k <= 3 && i - k >= 0 && words.length >= 3 * k; k++) {
      run = [...toks[i - k], ...run];
      consider(i, lineScore(words, run) * (1 - 0.03 * k));
    }
  }
  return best;
}
