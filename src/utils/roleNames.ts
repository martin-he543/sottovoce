/**
 * Character names in English: "DIAVOLO" → "Devil", "CORO DI DONNE" → "Chorus of women", "GIOVE" → "Jupiter". Libretti
 * name many parts by what they are (a chorus, a priest, a god) rather than who; those are translated word by word from
 * the glossary below. A proper name ("Rodrigo") has no entry and stays as it is.
 */

const WORDS: Record<string, string> = {
  // Italian: groups and voices
  coro: 'chorus', cori: 'choruses', tutti: 'all', tutte: 'all', tutto: 'all', altri: 'others', altre: 'others', altro: 'other',
  altra: 'other', voci: 'voices', voce: 'voice', parte: 'part', uno: 'one', una: 'one', un: 'a', alcuni: 'some', alcune: 'some',
  nessuno: 'no one', interne: 'offstage', interna: 'offstage', interni: 'offstage', interno: 'offstage', lontane: 'distant',
  lontana: 'distant', lontano: 'distant', lontani: 'distant', generale: 'full', primi: 'first group', secondi: 'second group',
  folla: 'crowd', popolo: 'people', grida: 'shouts', ensemble: 'ensemble', entrambi: 'both', ambedue: 'both', insieme: 'together',
  col: 'with the', con: 'with', e: 'and', dentro: 'offstage', solo: 'solo', soli: 'soloists',
  // Italian: people
  donne: 'women', donna: 'woman', uomini: 'men', uomo: 'man', cavalieri: 'knights', cavaliere: 'knight', dame: 'ladies', dama: 'lady',
  damigelle: 'damsels', damigella: 'damsel', donzelle: 'maidens', donzella: 'maiden', soldati: 'soldiers', soldato: 'soldier',
  guerrieri: 'warriors', guerriero: 'warrior', sacerdoti: 'priests', sacerdote: 'priest', sacerdotessa: 'priestess', gran: 'high',
  grande: 'great', messo: 'messenger', messaggero: 'messenger', servo: 'servant', serva: 'maid', servi: 'servants', paggio: 'page',
  araldo: 'herald', pastore: 'shepherd', pastori: 'shepherds', pastorella: 'shepherdess', pastorelle: 'shepherdesses',
  ninfa: 'nymph', ninfe: 'nymphs', contadini: 'peasants', contadine: 'peasant women', contadino: 'peasant', contadina: 'peasant girl',
  armigeri: 'men-at-arms', arcieri: 'archers', guardie: 'guards', guardia: 'guard', ufficiali: 'officers', ufficiale: 'officer',
  capitano: 'captain', marinai: 'sailors', marinaio: 'sailor', cacciatori: 'hunters', cacciatore: 'hunter', borghesi: 'townsfolk',
  seguaci: 'followers', congiurati: 'conspirators', notaro: 'notary', notaio: 'notary', nutrice: 'nurse', oracolo: 'oracle',
  sirene: 'sirens', sirena: 'siren', schiavi: 'slaves', schiavo: 'slave', schiava: 'slave girl', ancelle: 'handmaidens',
  ancella: 'handmaiden', zingari: 'gypsies', zingare: 'gypsy women', zingara: 'gypsy woman', banditi: 'bandits', pirati: 'pirates',
  cortigiani: 'courtiers', cortigiano: 'courtier', ministro: 'minister', giudice: 'judge', medico: 'doctor', dottore: 'doctor',
  ambasciatore: 'ambassador', principe: 'prince', principessa: 'princess', re: 'king', regina: 'queen', imperatore: 'emperor',
  imperatrice: 'empress', duca: 'duke', duchessa: 'duchess', conte: 'count', contessa: 'countess', marchese: 'marquis',
  marchesa: 'marchioness', barone: 'baron', baronessa: 'baroness', visconte: 'viscount', podestà: 'mayor', governatore: 'governor',
  vecchio: 'old man', vecchia: 'old woman', giovane: 'young man', fanciulla: 'girl', fanciulle: 'girls', fanciullo: 'boy',
  fanciulli: 'boys', bambini: 'children', ragazzi: 'boys', ragazze: 'girls', angeli: 'angels', angelo: 'angel', spiriti: 'spirits',
  spirito: 'spirit', ombra: 'ghost', ombre: 'shades', demoni: 'demons', demonio: 'demon', diavolo: 'devil', diavoli: 'devils',
  furie: 'furies', furia: 'fury', mago: 'sorcerer', maga: 'sorceress', fata: 'fairy', fate: 'fairies', geni: 'genies',
  // Italian: gods and allegories
  amore: 'Cupid', venere: 'Venus', giove: 'Jupiter', mercurio: 'Mercury', giunone: 'Juno', plutone: 'Pluto', nettuno: 'Neptune',
  pallade: 'Pallas', minerva: 'Minerva', marte: 'Mars', bacco: 'Bacchus', imeneo: 'Hymen', eolo: 'Aeolus', caronte: 'Charon',
  zeffiro: 'Zephyr', teti: 'Thetis', ercole: 'Hercules', proserpina: 'Proserpine', cerere: 'Ceres', vulcano: 'Vulcan',
  eco: 'Echo', fortuna: 'Fortune', virtù: 'Virtue', discordia: 'Discord', gloria: 'Glory', tempo: 'Time', sonno: 'Sleep',
  fama: 'Fame', pace: 'Peace', guerra: 'War', morte: 'Death', speranza: 'Hope', fede: 'Faith', natura: 'Nature', destino: 'Fate',
  sole: 'Sun', luna: 'Moon', aurora: 'Dawn', notte: 'Night', giorno: 'Day', verità: 'Truth', bellezza: 'Beauty', piacere: 'Pleasure',
  // German
  chor: 'chorus', alle: 'all', beide: 'both', andere: 'others', anderen: 'others', andern: 'others', einige: 'some', eine: 'a',
  ein: 'a', stimme: 'voice', stimmen: 'voices', frauen: 'women', männer: 'men', mädchen: 'girls', knaben: 'boys', volk: 'people',
  drei: 'three', vier: 'four', allgemeiner: 'full', männerchor: "men's chorus", frauenchor: "women's chorus", landleute: 'country folk',
  dienerinnen: 'maids', diener: 'servant', sklaven: 'slaves', priester: 'priests', graf: 'count', gräfin: 'countess',
  haushofmeister: 'major-domo', könig: 'king', königin: 'queen', fürst: 'prince', prinz: 'prince', prinzessin: 'princess',
  ritter: 'knights', soldaten: 'soldiers', jäger: 'huntsmen', bauern: 'peasants', geister: 'spirits', damen: 'ladies',
  sprecher: 'speaker', geharnischte: 'armed men', mohr: 'Moor', nacht: 'night', hirte: 'shepherd', hirten: 'shepherds',
  mutter: 'mother', vater: 'father', tochter: 'daughter', sohn: 'son', wache: 'guard', wachen: 'guards', bote: 'messenger',
  teufel: 'devil', engel: 'angel', hexe: 'witch', zwerg: 'dwarf', riese: 'giant', riesen: 'giants', nixen: 'water nymphs',
  // French
  chœur: 'chorus', choeur: 'chorus', tous: 'all', toutes: 'all', femmes: 'women', hommes: 'men', foule: 'crowd', peuple: 'people',
  soldats: 'soldiers', prêtres: 'priests', prêtre: 'priest', voix: 'voice', autres: 'others', jeunes: 'young', filles: 'girls',
  garçons: 'boys', cigarières: 'cigarette girls', contrebandiers: 'smugglers', dragons: 'dragoons', gamins: 'street boys',
  roi: 'king', reine: 'queen', comte: 'count', comtesse: 'countess', diable: 'devil', bergers: 'shepherds', berger: 'shepherd',
  bergère: 'shepherdess', nymphes: 'nymphs', démons: 'demons', esprits: 'spirits', seigneurs: 'lords', dames: 'ladies',
  // Spanish
  todos: 'all', mujeres: 'women', hombres: 'men', pueblo: 'people', soldados: 'soldiers',
};

/** Words that only carry grammar ("il", "der", "les"), and those that join ("di" → "of"). */
const DROP = new Set(['il', 'lo', 'la', 'le', 'i', 'gli', 'l', 'der', 'die', 'das', 'den', 'dem', 'les', 'un', 'une', 'el', 'los', 'las']);
const JOIN: Record<string, string> = { di: 'of', del: 'of the', della: 'of the', dei: 'of the', degli: 'of the', delle: 'of the', des: 'of the', de: 'of', du: 'of the', d: 'of' };

const cache = new Map<string, string>();

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The English for a character name, or '' when it is a proper name (or already English). Works on any casing: the
 * answer follows the glossary's casing, sentence-cased ("Chorus of women").
 */
export function roleInEnglish(name: string): string {
  const raw = name.trim();
  if (!raw) return '';
  const hit = cache.get(raw);
  if (hit !== undefined) return hit;
  const inner = raw.replace(/^[(\[]\s*|\s*[)\]]$/g, '');
  const words = inner.toLowerCase().split(/[\s'’]+/).filter(Boolean);
  const out: string[] = [];
  let known = 0;
  let unknown = 0;
  for (const w of words) {
    const bare = w.replace(/[.,;:!?]+$/, '');
    if (WORDS[bare]) {
      out.push(WORDS[bare]);
      known++;
    } else if (JOIN[bare]) out.push(JOIN[bare]);
    else if (DROP.has(bare)) continue;
    else {
      // A name after a title ("Conte Almaviva") stays as written.
      out.push(bare.charAt(0).toUpperCase() + bare.slice(1));
      unknown++;
    }
  }
  // Only a name the glossary mostly understands is translated: "Don Alvaro" is no "Don" anything.
  let en = known && known >= unknown ? sentence(out.join(' ').replace(/\s+/g, ' ')) : '';
  if (en && en.toLowerCase() === inner.toLowerCase()) en = '';
  cache.set(raw, en);
  return en;
}
