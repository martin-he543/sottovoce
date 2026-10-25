/** Minimal wikitext → plain text helpers, tuned for opera/musical articles (lead, Synopsis, Roles table, numbers). */

/** Templates whose last positional argument is the readable text (e.g. {{lang|it|Vissi d'arte}}). */
const KEEP_LAST_ARG = /^(lang|lang-\w+|nowrap|nobr|small|big|smaller|larger|em|strong|transl|transliteration|abbr|sc|smallcaps|nowrap begin|langx|noitalic|vr|visible anchor|anchor-text|resize|font|color|colour|IPA|lang-de|lang-it|lang-fr|my|title case|sic|as written|sortname)$/i;
/** Templates rendered as a short literal. */
const LITERAL = { ndash: '–', mdash: '—', '–': '–', '—': '—', 'snd': ' – ', spaced_ndash: ' – ', 'sndash': ' – ', '!': '|', 'nbsp': ' ', '=': '=', 'circa': 'c. ', 'c.': 'c. ', 'flat': '♭', 'sharp': '♯', 'music': '' };

/** Replace every top-level {{…}} (handling nesting) with fn(inner). */
function mapTemplates(s, fn) {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const start = s.indexOf('{{', i);
    if (start < 0) { out += s.slice(i); break; }
    out += s.slice(i, start);
    let depth = 0;
    let j = start;
    for (; j < s.length - 1; j++) {
      if (s[j] === '{' && s[j + 1] === '{') { depth++; j++; }
      else if (s[j] === '}' && s[j + 1] === '}') { depth--; j++; if (depth === 0) break; }
    }
    if (depth !== 0) { out += s.slice(start); break; }
    out += fn(s.slice(start + 2, j - 1));
    i = j + 1;
  }
  return out;
}

/** Split template args on top-level pipes (ignoring pipes inside [[…]] and nested {{…}}). */
function splitArgs(inner) {
  const args = [];
  let cur = '';
  let sq = 0;
  let cu = 0;
  for (let k = 0; k < inner.length; k++) {
    const two = inner.slice(k, k + 2);
    if (two === '[[') { sq++; cur += two; k++; continue; }
    if (two === ']]') { sq--; cur += two; k++; continue; }
    if (two === '{{') { cu++; cur += two; k++; continue; }
    if (two === '}}') { cu--; cur += two; k++; continue; }
    if (inner[k] === '|' && sq === 0 && cu === 0) { args.push(cur); cur = ''; continue; }
    cur += inner[k];
  }
  args.push(cur);
  return args;
}

function renderTemplate(inner) {
  const args = splitArgs(inner);
  const name = args[0].trim().replace(/_/g, ' ');
  const lname = name.toLowerCase();
  const positional = args.slice(1).filter((a) => !/^\s*[\w -]+\s*=/.test(a));
  if (lname in LITERAL) return LITERAL[lname];
  if (KEEP_LAST_ARG.test(name)) return positional.length ? toPlain(positional[positional.length - 1]) : '';
  if (/^(lang-|langx)/i.test(name)) return positional.length ? toPlain(positional[positional.length - 1]) : '';
  if (/^(ill|interlanguage link|interlanguage link multi|ill2|iw)$/i.test(lname)) return positional.length ? toPlain(positional[0]) : '';
  if (/^(opera role|role)/i.test(lname)) return positional.length ? toPlain(positional[0]) : '';
  if (/^(sortname)/i.test(lname)) return positional.slice(0, 2).map(toPlain).join(' ');
  if (/^(as of)$/i.test(lname)) return `as of ${positional.join(' ')}`;
  if (/^(start date|start date and age|date|dts)$/i.test(lname)) return positional.slice(0, 3).join('-');
  if (/^(convert)$/i.test(lname)) return positional.slice(0, 2).join(' ');
  if (/^(okina)$/i.test(lname)) return 'ʻ';
  if (/^(hlist|flatlist|plainlist|unbulleted list|ubl|plain list)$/i.test(lname)) return positional.flatMap((a) => a.split(/\n\s*[*#]+/)).map(toPlain).filter(Boolean).join(', ');
  return '';
}

/** Convert a wikitext fragment to readable plain text. */
export function toPlain(s) {
  if (!s) return '';
  let t = String(s);
  t = t.replace(/<!--[\s\S]*?-->/g, '');
  t = t.replace(/<ref[^>]*\/>/gi, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '');
  t = t.replace(/<(gallery|math|score|timeline|imagemap|syntaxhighlight)[^>]*>[\s\S]*?<\/\1>/gi, '');
  t = mapTemplates(t, renderTemplate);
  // Files / images / categories (may contain nested links in captions)
  t = t.replace(/\[\[(?:File|Image|Category|Media):(?:[^\[\]]|\[\[[^\]]*\]\])*\]\]/gi, '');
  t = t.replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1');
  t = t.replace(/\[(?:https?:)?\/\/[^\s\]]+\s+([^\]]+)\]/g, '$1').replace(/\[(?:https?:)?\/\/[^\]]+\]/g, '');
  t = t.replace(/'''''|'''|''/g, '');
  t = t.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?[a-z][^>]*>/gi, '');
  t = t.replace(/&nbsp;/g, ' ').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  t = t.replace(/__[A-Z]+__/g, '');
  t = t.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n');
  t = t.replace(/\( *[,;]? *\)/g, '').replace(/ +([,.;:])/g, '$1');
  return t.trim();
}

/** Split an article into { lead, sections: [{ level, heading, body }] }. */
export function splitSections(wikitext) {
  const re = /^(={2,6})\s*(.+?)\s*\1\s*$/gm;
  const sections = [];
  let m;
  let lastIdx = 0;
  let last = null;
  let lead = '';
  while ((m = re.exec(wikitext))) {
    const chunk = wikitext.slice(lastIdx, m.index);
    if (last) last.body = chunk; else lead = chunk;
    last = { level: m[1].length, heading: toPlain(m[2]), body: '' };
    sections.push(last);
    lastIdx = re.lastIndex;
  }
  if (last) last.body = wikitext.slice(lastIdx); else lead = wikitext;
  return { lead, sections };
}

/** The section matching `test` plus all its deeper subsections. */
export function sectionTree(sections, test) {
  const i = sections.findIndex((s) => test(s.heading));
  if (i < 0) return null;
  const root = sections[i];
  const parts = [root];
  for (let k = i + 1; k < sections.length && sections[k].level > root.level; k++) parts.push(sections[k]);
  return parts;
}

/** Strip block-level noise (tables, file lines, hatnotes) from prose before toPlain. */
export function proseOnly(wt) {
  let t = wt.replace(/\{\|[\s\S]*?\n\|\}/g, '');
  t = t.replace(/^\s*\[\[(File|Image):.*$/gim, '');
  return toPlain(t)
    .split('\n')
    .map((l) => l.replace(/^[*#:;]+\s*/, '').trim())
    .filter((l) => l && !/^(thumb|upright|right|left)\b/i.test(l))
    .join('\n');
}

/** Parse the first wikitable in a block into rows of plain-text cells. */
export function parseTable(wt) {
  const m = wt.match(/\{\|[\s\S]*?\n\|\}/);
  if (!m) return [];
  const body = m[0].replace(/^\{\|.*\n/, '').replace(/\n\|\}$/, '');
  const rows = [];
  for (const rawRow of body.split(/\n\|-[^\n]*/)) {
    const cells = [];
    let header = false;
    for (const line of rawRow.split('\n')) {
      const lm = line.match(/^\s*([|!])(?!\+)(.*)$/);
      if (!lm) { if (cells.length) cells[cells.length - 1].text += '\n' + line; continue; }
      if (lm[1] === '!') header = true;
      for (const c of lm[2].split(/\|\||!!/)) {
        // Drop cell attributes: `style="…" | content` (but keep [[a|b]] links intact).
        const cm = c.match(/^([^[\]{}|]*=[^[\]{}|]*)\|(?!\|)([\s\S]*)$/);
        const text = cm ? cm[2] : c;
        const span = cm && /rowspan\s*=\s*"?(\d+)/i.exec(cm[1]);
        cells.push({ text, rowspan: span ? +span[1] : 1 });
      }
    }
    if (cells.length) rows.push({ header, cells: cells.map((c) => ({ text: toPlain(c.text).replace(/\n+/g, ' '), rowspan: c.rowspan })) });
  }
  return rows;
}

/** Bullet / numbered list items in a block, as plain text. */
export function listItems(wt) {
  return wt
    .split('\n')
    .filter((l) => /^[*#]/.test(l))
    .map((l) => toPlain(l.replace(/^[*#:]+\s*/, '')).replace(/\n+/g, ' ').trim())
    .filter(Boolean);
}
