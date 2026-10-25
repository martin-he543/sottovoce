/** Loads full libretti (public/libretti/texts) and turns them into the lines and sections the Follow reader uses. */
import type { LibrettoLine, LibrettoText, LibrettoTextIndex, WorkAndLibretto } from '../types/sottovoce';
import { lyricTokens } from './lyricMatch';
import { roleInEnglish } from './roleNames';
import type { DocEntry, DocSection, FollowDoc } from './followDoc';

const BASE = `${(import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'}libretti/texts/`;

let indexPromise: Promise<LibrettoTextIndex | null> | null = null;
/** Which works have a full libretto. Null when the folder is not deployed. */
export const loadTextIndex = () =>
  (indexPromise ??= fetch(`${BASE}index.json`)
    .then((r) => (r.ok ? (r.json() as Promise<LibrettoTextIndex>) : null))
    .catch(() => null));

const TRANSLATIONS = BASE.replace(/texts\/$/, 'translations/');

/** English for every act heading, scene title and scene setting of a libretto, in act → scene order. */
export interface SceneTranslations {
  a: string[];
  t: string[];
  d: string[];
}

/** A full libretto, with its offline English translation attached when one is stored. */
export async function loadText(id: string): Promise<LibrettoText | null> {
  try {
    const [r, t, sc] = await Promise.all([
      fetch(`${BASE}${id}.json`),
      fetch(`${TRANSLATIONS}${id}.json`).catch(() => null),
      fetch(`${TRANSLATIONS}scenes/${id}.json`).catch(() => null),
    ]);
    if (!r.ok) return null;
    const text = (await r.json()) as LibrettoText;
    if (t?.ok) {
      const en = (await t.json().catch(() => null)) as unknown;
      if (Array.isArray(en)) text.en = en as string[];
    }
    if (sc?.ok) {
      const notes = (await sc.json().catch(() => null)) as Partial<SceneTranslations> | null;
      if (notes && Array.isArray(notes.d) && Array.isArray(notes.t) && Array.isArray(notes.a)) text.scenesEn = notes as SceneTranslations;
    }
    return text;
  } catch {
    return null;
  }
}

const ORDINALS: Record<string, number> = {
  // Italian
  primo: 1, prima: 1, uno: 1, secondo: 2, seconda: 2, due: 2, terzo: 3, terza: 3, tre: 3, quarto: 4, quarta: 4, quattro: 4,
  quinto: 5, quinta: 5, cinque: 5, sesto: 6, sesta: 6, sei: 6, settimo: 7, settima: 7, sette: 7, ottavo: 8, ottava: 8, otto: 8,
  nono: 9, nona: 9, nove: 9, decimo: 10, decima: 10, dieci: 10, undicesimo: 11, undicesima: 11, dodicesimo: 12, dodicesima: 12,
  ultimo: 0, ultima: 0, unica: 1, unico: 1,
  // German
  einziger: 1, einzige: 1, erste: 1, erster: 1, erstes: 1, zweite: 2, zweiter: 2, zweites: 2, dritte: 3, dritter: 3, drittes: 3, vierte: 4, vierter: 4, viertes: 4,
  fünfte: 5, fünfter: 5, fünftes: 5, sechste: 6, sechster: 6, sechstes: 6, siebte: 7, siebter: 7, siebtes: 7,
  achte: 8, achter: 8, achtes: 8, neunte: 9, neunter: 9, neuntes: 9, zehnte: 10, zehnter: 10, zehntes: 10,
  // French
  premier: 1, première: 1, deuxième: 2, troisième: 3, quatrième: 4, cinquième: 5, sixième: 6, septième: 7, huitième: 8,
  neuvième: 9, dixième: 10,
  // Spanish
  primero: 1, primera: 1, segundo: 2, segunda: 2, tercero: 3, tercera: 3, cuarto: 4, cuarta: 4, único: 1, única: 1,
  // English, as some texts are already headed in it
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
};
const ROMANS: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16, xvii: 17, xviii: 18, xix: 19, xx: 20 };
// Italian ordinals past ten, by stem (the -a/-o/-e/-i ending is dropped): "tredicesima", "ventiduesimo", "undecima".
const IT_STEMS: Record<string, number> = {
  prim: 1, second: 2, terz: 3, quart: 4, quint: 5, sest: 6, settim: 7, ottav: 8, non: 9, decim: 10, undicesim: 11, undecim: 11,
  dodicesim: 12, duodecim: 12, tredicesim: 13, quattordicesim: 14, quindicesim: 15, sedicesim: 16, diciassettesim: 17,
  diciottesim: 18, diciannovesim: 19, ventesim: 20, ventunesim: 21, ventiduesim: 22, ventitreesim: 23, ventiquattresim: 24,
  venticinquesim: 25, ventiseiesim: 26, ventisettesim: 27, ventottesim: 28, ventinovesim: 29, trentesim: 30, trentunesim: 31,
};
const IT_UNITS = ['prim', 'second', 'terz', 'quart', 'quint', 'sest', 'settim', 'ottav', 'non'];
const FINAL = new Set(['ultimo', 'ultima', 'ultimi', 'letzte', 'letzter', 'letztes', 'dernière', 'dernier', 'last', 'final']);
/** One word as a number, or two run together ("decimaquarta", "ventesimaprima"). */
const wordNumber = (w: string): number | undefined => {
  if (ORDINALS[w] || ROMANS[w] || /^\d+$/.test(w)) return ORDINALS[w] ?? ROMANS[w] ?? Number(w);
  const stem = w.replace(/[aoie]$/, '');
  if (IT_STEMS[stem]) return IT_STEMS[stem];
  const fused = /^(decim|ventesim|trentesim)a?(prim|second|terz|quart|quint|sest|settim|ottav|non)$/.exec(stem);
  return fused ? IT_STEMS[fused[1]] + IT_UNITS.indexOf(fused[2]) + 1 : undefined;
};
const numberOf = (word: string): number | undefined => {
  const w = word.toLowerCase().replace(/[.:]$/, '');
  const one = wordNumber(w);
  if (one) return one;
  // "decima terza", "decima quarta e ultima": drop "e"/final markers, add a teens' unit to its ten.
  const parts = w.split(/\s+/).filter((x) => x !== 'e' && x !== 'et' && x !== 'und' && !FINAL.has(x));
  const nums = parts.map(wordNumber);
  if (!nums.length || nums.some((n) => !n)) return undefined;
  return nums.length === 2 && nums[0]! % 10 === 0 && nums[1]! < 10 ? nums[0]! + nums[1]! : nums.length === 1 ? nums[0] : undefined;
};

/**
 * "Atto secondo" → "Act 2", "ZWEITER AKT" → "Act 2", "SCÈNE III" → "Scene 3". The number may come after the noun
 * (Italian, French) or before it (German); a subtitle after a dash or colon is kept. Anything else comes back
 * unchanged, so the caller can show a translation of it instead.
 */
function heading(raw: string, noun: Record<string, string>, fallback: string): string {
  const text = raw.replace(/\.$/, '').trim();
  if (!text) return fallback;
  const [main, ...sub] = text.split(/\s+[-–—:]\s+|:\s+/);
  const subtitle = sub.join(' – ').trim();
  const words = main.replace(/^[IVX]+\.\s+/, '').split(/\s+/);
  const nounAt = words.findIndex((w) => noun[w.toLowerCase()]);
  if (nounAt < 0 || nounAt > 1) return text;
  const en = noun[words[nounAt].toLowerCase()];
  const rest = words.filter((_, i) => i !== nounAt).join(' ');
  const restWords = rest.toLowerCase().split(/\s+/).filter(Boolean);
  const isFinal = restWords.some((w) => FINAL.has(w));
  const n = rest ? numberOf(rest) : undefined;
  if (!n && !isFinal && rest.includes(' ')) return text;
  const base = n ? `${en} ${n}${isFinal ? ' (final)' : ''}` : isFinal ? `Final ${en.toLowerCase()}` : rest ? `${en} ${rest}` : en;
  return subtitle ? `${base} · ${subtitle}` : base;
}
/** True when `heading` understood the text (it is "Act 2" now, not what was written). */
const understood = (shown: string, raw: string) => shown !== raw.replace(/\.$/, '').trim() && shown !== '';
const ACT_NOUNS = {
  atto: 'Act', parte: 'Part', prologo: 'Prologue', epilogo: 'Epilogue', introduzione: 'Introduction', intermezzo: 'Intermezzo',
  akt: 'Act', aufzug: 'Act', vorspiel: 'Prelude', prolog: 'Prologue', acte: 'Act', tableau: 'Tableau', act: 'Act',
  azione: 'Act', quadro: 'Tableau', bild: 'Tableau', partie: 'Part', teil: 'Part', acto: 'Act', cuadro: 'Tableau',
  prologue: 'Prologue', epilogue: 'Epilogue', épilogue: 'Epilogue', prélude: 'Prelude', ouverture: 'Overture', ouvertura: 'Overture',
  ouvertüre: 'Overture', nachspiel: 'Epilogue', epilog: 'Epilogue', zwischenspiel: 'Interlude',
};
const SCENE_NOUNS = {
  scena: 'Scene', quadro: 'Scene', tableau: 'Scene', szene: 'Scene', auftritt: 'Scene', bild: 'Scene', scène: 'Scene', scene: 'Scene',
  escena: 'Scene', cuadro: 'Scene', parte: 'Part', partie: 'Part', teil: 'Part', azione: 'Part',
};

// A numbered piece: "No 2 - Scène", "Nr. 8 - Duett", "N° 12", "Nï¿½ 1" (mangled º), or a bare "1bis - Choeur".
const NUMBER_MARK = /^(?:(?:no|nr|num(?:ber|mer|éro)?|n[^\w\s]{0,3})\.?\s*)?(\d+\s*(?:bis|ter|[a-z])?)\s*[-–—:]\s*(\S.*)$/i;
// A scene named on a line of its own: "Scène II", "Szene 3", "Scena seconda".
const SCENE_MARK = /^(?:sc[eè]ne|scena|szene|auftritt|escena)\s+[\wàèéìòù]+(?:\s+(?:e|et|und)\s+\w+)?\.?$/i;
type Scenes = (LibrettoText['acts'][number]['scenes'][number] & { cont?: boolean })[];
/** Cuts a scene wherever a stage direction names a numbered piece or a scene. Fewer than two such cuts: kept whole. */
function splitNumbers(scene: Scenes[number]): Scenes {
  const label = (dir: string) => {
    const t = dir.trim();
    if (SCENE_MARK.test(t)) return heading(t, SCENE_NOUNS, t);
    const m = NUMBER_MARK.exec(t);
    return m ? `No. ${m[1].trim().replace(/\s+/g, ' ')} · ${m[2]}` : '';
  };
  const marks = scene.lines.flatMap((l, i) => (l[2] === 'dir' && l[1].length < 90 && label(l[1]) ? [i] : []));
  // One piece that opens the scene is the scene itself; one that begins partway in splits off what comes before it.
  // Directions alone before the first piece (a setting) belong to that piece, not a scene of their own.
  const lead = marks.length > 0 && scene.lines.slice(0, marks[0]).some((l) => l[2] === 'sung');
  if (!marks.length || (marks.length < 2 && !lead)) return [scene];
  const opening = lead ? '' : scene.lines.slice(0, marks[0]).filter((l) => l[2] === 'dir').map((l) => l[1]).join(' ');
  const cuts = lead ? [0, ...marks] : marks;
  return cuts.map((from, k) => ({
    ...scene,
    title: lead && k === 0 ? scene.title : label(scene.lines[from][1]),
    // Stored scene translations belong to the scene as it was: the first piece keeps them, the rest start fresh.
    cont: k > 0,
    description: k === 0 ? [scene.description, opening].filter(Boolean).join(' ') : '',
    lines: scene.lines.slice(k === 0 ? 0 : from, cuts[k + 1] ?? scene.lines.length),
  }));
}

/** Scraped notes run sentences together ("Valle.A destra"): put the space back. */
export const tidy = (s: string) => s.trim().replace(/([a-zà-ÿ]{2,}[.;:!?])([A-ZÀ-Ý])/g, '$1 $2');

/** The first sentence of a stage direction, kept short enough for a contents list. */
const firstSentence = (s: string) => {
  const one = s.split(/(?<=[.!?])\s/)[0].replace(/[.:;]$/, '');
  return one.length > 64 ? `${one.slice(0, 61).trimEnd()}…` : one;
};

const nice = (who: string) => who.toLowerCase().replace(/(^|[\s'’(-])([a-zà-ÿ])/g, (_, p, c) => p + c.toUpperCase());
const key = (s: string) => lyricTokens(s).join(' ');
const PASSAGE = 8;

/**
 * A full libretto as reader sections (act → scene → passages of a few lines) and as the line list the microphone and
 * scanner match against. When the work also has a hand-made libretto (`seed`), its translations and notes are kept on
 * the lines that match.
 */
export function buildTextDoc(
  text: LibrettoText,
  meta: { composer?: string; librettist?: string; workId?: string },
  seed?: WorkAndLibretto
): { doc: FollowDoc; work: WorkAndLibretto } {
  const seeded = new Map<string, LibrettoLine[]>();
  for (const l of seed?.lines ?? []) {
    const k = key(l.original_text);
    if (k) seeded.set(k, [...(seeded.get(k) ?? []), l]);
  }
  const lines: LibrettoLine[] = [];
  const sections: DocSection[] = [];
  let sungSoFar = 0;

  // A heading the normaliser did not recognise ("Il sortilegio", "In soffitta") is shown in English, with the original after it.
  const named = (raw: string, shown: string, en: string | undefined) =>
    en && !understood(shown, raw) && raw.trim() && en.toLowerCase() !== raw.trim().toLowerCase() ? `${en} · ${shown}` : shown;
  const notes = text.scenesEn;
  let sceneNo = 0;
  // Some sources (Carmen, the Flute) lump many numbered pieces ("No 2 - Scène et choeur", "Nr. 5 - Quintett") into one
  // scene: each piece becomes a scene of its own. Stored scene translations follow the original scenes, so only the
  // first piece of a split scene reads them (`cont` marks the rest).
  const acts = text.acts.map((a) => ({ ...a, scenes: a.scenes.flatMap((sc) => splitNumbers(sc)) }));
  acts.forEach((act, ai) => {
    // A bare "Act" holding only the prelude has nothing to sing.
    if (!notes && act.heading.trim().toLowerCase() === 'act' && !act.scenes.some((sc) => sc.lines.some((l) => l[2] === 'sung'))) return;
    const actTitle = heading(act.heading, ACT_NOUNS, `Act ${ai + 1}`);
    sections.push({ id: `a${ai}`, title: named(act.heading, actTitle, notes?.a[ai]), level: 1, entries: [] });
    act.scenes.forEach((scene, si) => {
      const sung = scene.lines.filter((l) => l[2] === 'sung');
      const cont = !!(scene as Scenes[number]).cont;
      const n = cont ? sceneNo - 1 : sceneNo++;
      // An act with no scene divisions at all is named by where it is set (its first stage direction), not "Scene 1".
      const opening = act.scenes.length === 1 && !scene.title && !scene.description ? scene.lines.find((l) => l[2] === 'dir' && l[1].trim().length > 3 && !l[1].includes('ï¿½')) : undefined;
      const sceneTitle = opening ? firstSentence(tidy(opening[1])) : heading(scene.title, SCENE_NOUNS, `Scene ${si + 1}`);
      const setting = scene.description ? tidy(scene.description) : opening ? tidy(opening[1]) : '';
      // English texts need no translation; for the rest the setting is paired with its English so both can be shown.
      const settingEn = text.language === 'English' || cont ? '' : notes?.d[n];
      sections.push({
        id: `a${ai}s${si}`,
        title: opening ? sceneTitle : named(scene.title, sceneTitle, cont || /^No\. /.test(scene.title) ? undefined : notes?.t[n]),
        level: 2,
        summary: setting || undefined,
        summaryTranslation: settingEn && settingEn !== setting ? settingEn : undefined,
        entries: [],
      });
      for (let i = 0; i < sung.length; i += PASSAGE) {
        const entries: DocEntry[] = sung.slice(i, i + PASSAGE).map(([who, line], k) => {
          const idx = lines.length;
          const machine = text.en?.[sungSoFar + i + k] ?? '';
          const hit = seeded.get(key(line))?.shift();
          lines.push({
            line_index: idx,
            bar_number: hit?.bar_number ?? 0,
            timestamp_sec: hit?.timestamp_sec ?? 0,
            character: hit?.character || nice(who),
            voice_type: hit?.voice_type ?? '',
            original_text: line,
            language: text.language,
            literal_english: hit?.literal_english ?? machine,
            dramatic_subtext: hit?.dramatic_subtext ?? '',
            musical_leitmotif: hit?.musical_leitmotif ?? '',
            leitmotif_id: hit?.leitmotif_id ?? '',
            stage_blocking: hit?.stage_blocking ?? [],
          });
          return {
            id: `l${idx}`,
            text: line,
            who: lines[idx].character,
            whoEn: text.language === 'English' ? undefined : roleInEnglish(lines[idx].character) || undefined,
            translation: hit?.literal_english || machine || undefined,
            subtext: hit?.dramatic_subtext,
            kind: 'line' as const,
            libIdx: idx,
          };
        });
        if (!entries.length) continue;
        const words = entries[0].text.replace(/\s+/g, ' ').split(' ');
        sections.push({
          id: `a${ai}s${si}p${i}`,
          title: `“${words.slice(0, 5).join(' ')}${words.length > 5 ? '…' : ''}”`,
          level: 3,
          entries,
        });
      }
      sungSoFar += sung.length;
    });
  });

  const base: WorkAndLibretto = seed ?? {
    _id: `text:${text.id}`,
    work_id: `text:${text.id}`,
    title: text.title,
    composer: meta.composer ?? '',
    librettist: meta.librettist ?? '',
    language: text.language,
    venue_id: '',
    venue_name: '',
    current_act: 1,
    current_scene: 1,
    scene_title: '',
    setting_description: '',
    synopsis_5min_ago: '',
    happening_now: '',
    character_motivations: '',
    stage_design_style: 'baroque_palazzo',
    characters: [],
    leitmotifs: [],
    voyage_embedding_model: 'voyage-3',
    semantic_tags: [],
    sonic_mood_descriptors: [],
    similar_modern_artists: [],
    lines: [],
  };
  return { doc: { sections, hasLibretto: true }, work: { ...base, lines } };
}
