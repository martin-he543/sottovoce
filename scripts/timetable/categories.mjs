/** Single source of truth for timetable categories (the UI imports the same ids from src/data/timetableCategories.ts). */
export const CATEGORIES = ['opera', 'classical', 'live_music', 'drama', 'musical', 'dance'];

/** Best-effort guess from free text; adapters should pass an explicit category when the venue page states one. */
export function guessCategory(text, fallback = null) {
  const t = ` ${String(text || '').toLowerCase()} `;
  if (/\b(opera|operetta|la traviata|tosca|carmen|bohème|boheme|figaro|don giovanni|magic flute|aida|rigoletto|turandot|norma|lucia|tristan|ring cycle|wagner|puccini|verdi|rossini|handel opera)\b/.test(t)) return 'opera';
  if (/\b(ballet|dance|choreograph|contemporary dance|flamenco|tango|hofesh|akram khan|bourne)\b/.test(t)) return 'dance';
  if (/\b(the musical|a musical|musical comedy|west end musical|jukebox)\b/.test(t)) return 'musical';
  if (/\b(symphony|symphonic|orchestra|philharmonic|sinfonia|string quartet|quartet|recital|chamber music|piano recital|concerto|sonata|choir|choral|requiem|baroque|bach|beethoven|mozart|brahms|mahler|schubert|chopin|lieder|early music|organ recital|cantata|vespers|evensong|proms)\b/.test(t)) return 'classical';
  if (/\b(live music|gig|band|jazz|folk|rock|indie|pop|hip.hop|rap|dj set|singer|songwriter|acoustic|blues|soul|funk|electronic|reggae|world music|cabaret|concert)\b/.test(t)) return 'live_music';
  if (/\b(play|drama|theatre|theater|comedy|tragedy|monologue|shakespeare|new writing|stage|revival)\b/.test(t)) return 'drama';
  return fallback;
}
