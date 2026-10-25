import { plansFor, seatSightline, type PlanLayout, type SeatPlan, type SeatPlanSummary } from './seatPlan';

/**
 * What a seat costs. Three sources, best first:
 *
 *   captured  the plan's own price bands, read off the venue's booking map for one performance (scripts/seatmaps/);
 *             seats sold or held when it was captured take the band of the nearest priced seat
 *   typical   the venue's usual full-price range (below), spread over the house by how good each seat's view is
 *   listing   either of the above, rescaled to one performance's listed price ("from £15", "£15–£95")
 *
 * Prices move with the date, the production and demand, so every figure is a guide and the venue's site has the real one.
 */

/**
 * Usual full-price range (£, cheapest to dearest seat) for each plan's main productions, 2025/26. Approximate,
 * from the venues' published price ranges; premium and dynamic pricing go higher.
 */
export const TYPICAL_PRICES: Record<string, [number, number]> = {
  adelphi: [25, 175],
  aldwych: [25, 150],
  ambassadors: [20, 95],
  'apollo-victoria': [25, 135],
  'barbican-hall': [15, 95],
  bridge: [25, 125],
  cambridge: [25, 150],
  coliseum: [15, 155],
  criterion: [25, 110],
  dominion: [25, 175],
  'drury-lane': [25, 195],
  duchess: [20, 100],
  garrick: [25, 130],
  globe: [5, 85],
  gielgud: [25, 150],
  'gillian-lynne': [25, 175],
  hampstead: [20, 55],
  'harold-pinter': [25, 150],
  haymarket: [25, 150],
  'his-majestys': [30, 175],
  lyceum: [39, 109],
  'lyric-hammersmith': [15, 45],
  'lyric-theatre': [25, 150],
  'noel-coward': [25, 150],
  novello: [25, 140],
  'nt-lyttelton': [20, 99],
  'nt-olivier': [20, 99],
  palace: [30, 175],
  peacock: [15, 75],
  phoenix: [25, 150],
  piccadilly: [25, 160],
  'prince-edward': [25, 175],
  'prince-of-wales': [35, 175],
  rah: [15, 150],
  roh: [12, 290],
  'royal-court': [12, 45],
  'sam-wanamaker': [15, 75],
  sadlers: [15, 85],
  'sadlers-east': [15, 50],
  savoy: [25, 150],
  shaftesbury: [25, 140],
  sondheim: [25, 195],
  'st-martins': [25, 90],
  'tom-stoppard': [25, 130],
  trafalgar: [25, 95],
  vaudeville: [25, 110],
  'victoria-palace': [45, 250],
  wigmore: [15, 50],
  wyndhams: [25, 150],
};

export interface SeatPricing {
  source: 'captured' | 'typical';
  /** Band prices in £, cheapest first. */
  bands: number[];
  /** Band index of each seat in layout.seats (-1: unknown). */
  band: Int16Array;
  /** Seats in each band. */
  counts: number[];
  range: [number, number];
  /** Captured prices include the booking fee. */
  fees?: boolean;
  captured?: string;
  production?: string;
  /** Captured seats whose band was taken from a neighbour. */
  inferred?: number;
}

/** Share of the house in each estimated band, dearest first (best seats are a minority; cheap seats fill the back). */
const ESTIMATE_SHARES = [0.15, 0.2, 0.2, 0.17, 0.15, 0.13];

/** £ rounded the way box offices price: whole pounds under £20, then fives. */
const boxOffice = (n: number) => (n < 20 ? Math.round(n) : Math.round(n / 5) * 5);

/** `n` prices from lo to hi, closer together at the cheap end (each step a constant ratio). */
export function estimateBands([lo, hi]: [number, number], n = ESTIMATE_SHARES.length): number[] {
  if (hi <= lo) return [lo];
  const out = Array.from({ length: n }, (_, i) => (i === 0 ? lo : i === n - 1 ? hi : boxOffice(lo * (hi / lo) ** (i / (n - 1)))));
  return [...new Set(out)];
}

/** How good a seat is (lower is better): distance to the stage, plus a penalty for looking from the side. */
const seatCost = (s: PlanLayout['seats'][number]) => {
  const v = seatSightline(s);
  return v.distance + 0.12 * v.offAxis;
};

/** Every seat's price band, from the plan's captured prices or the venue's typical range. Null when neither is known. */
export function pricePlan(plan: SeatPlan, layout: PlanLayout): SeatPricing | null {
  const band = new Int16Array(layout.seats.length).fill(-1);
  if (plan.prices?.bands.length) {
    // layoutPlan visits levels → sections → rows → seats in order, so the tuples line up with layout.seats.
    let i = 0;
    for (const level of plan.levels)
      for (const sec of level.sections)
        for (const r of sec.rows)
          for (const t of r.seats) band[i++] = t[3] ?? -1;
    const { bands } = plan.prices;
    return {
      source: 'captured',
      bands,
      band,
      counts: bands.map((_, b) => band.filter((x) => x === b).length),
      range: [bands[0], bands[bands.length - 1]],
      fees: plan.prices.fees,
      captured: plan.prices.captured,
      production: plan.prices.production,
      inferred: plan.prices.inferred,
    };
  }
  const range = TYPICAL_PRICES[plan.id];
  if (!range || !layout.seats.length) return null;
  const bands = estimateBands(range);
  const order = layout.seats.map((s, i) => ({ i, c: seatCost(s) })).sort((a, b) => a.c - b.c);
  // Dearest band for the best-placed seats, down to the cheapest at the back and sides.
  let k = 0;
  let cum = 0;
  const shares = ESTIMATE_SHARES.slice(0, bands.length);
  shares.forEach((share, j) => {
    cum += share / shares.reduce((a, b) => a + b, 0);
    const end = j === shares.length - 1 ? order.length : Math.round(cum * order.length);
    for (; k < end; k++) band[order[k].i] = bands.length - 1 - j;
  });
  return { source: 'typical', bands, band, counts: bands.map((_, b) => band.filter((x) => x === b).length), range };
}

/** A seat's price, or null when its band is unknown. */
export const seatPrice = (pricing: SeatPricing, seat: number): number | null => {
  const b = pricing.band[seat];
  return b >= 0 ? pricing.bands[b] : null;
};

/** The price range a plan's venue usually charges (captured bands first), for lists of venues. */
export function planPriceRange(p: Pick<SeatPlanSummary, 'id' | 'priceRange'>): [number, number] | null {
  return p.priceRange ?? TYPICAL_PRICES[p.id] ?? null;
}

/** The usual price range at a listing's venue (from its seating plan), for listings that give no price. */
export function usualPriceAt(index: SeatPlanSummary[], venue: { id?: string; name?: string; hall?: string | null }): [number, number] | null {
  const plan = plansFor(index, venue)[0];
  return plan ? planPriceRange(plan) : null;
}

export interface ListingPrice {
  min: number;
  /** Null when the listing only says "from £N". */
  max: number | null;
}

/** "from £28", "from £15-£48", "from £18 (up to £45)", "£25, £45, £65" → { min, max }. Null when no price is listed. */
export function parseListingPrice(price?: string | null): ListingPrice | null {
  const nums = (price?.match(/\d+(?:\.\d+)?/g) ?? []).map(Number).filter((n) => n > 0);
  if (!nums.length) return null;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  return { min, max: max > min ? max : null };
}

/**
 * A seat's price at one performance: its place in the venue's range, carried over to the listing's range. A listing
 * that only gives "from £N" keeps the venue's top price (or £N, if that is higher).
 */
export function priceAtListing(price: number, range: [number, number], listing: ListingPrice): number {
  const [lo, hi] = range;
  const eMax = listing.max ?? Math.max(hi, listing.min);
  if (hi <= lo) return listing.min;
  const t = Math.min(1, Math.max(0, (price - lo) / (hi - lo)));
  return boxOffice(listing.min + t * (eMax - listing.min));
}

/** "£25", "£54.50". */
export const gbp = (n: number) => (Number.isInteger(n) ? `£${n.toLocaleString('en-GB')}` : `£${n.toFixed(2)}`);

/** "£15–£95". */
export const gbpRange = ([lo, hi]: [number, number]) => (lo === hi ? gbp(lo) : `${gbp(lo)}–${gbp(hi)}`);

/** Cheap → dear: teal, green, gold, orange, crimson, plum. */
const PRICE_RAMP = ['#2F8C84', '#5E9E4B', '#C9A227', '#D9782D', '#B3243C', '#7D3C98'];

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** Colour for band `b` of `n`, blended along the ramp so every band gets its own shade. */
export function bandColor(b: number, n: number): string {
  const t = n <= 1 ? 0.5 : b / (n - 1);
  const f = t * (PRICE_RAMP.length - 1);
  const i = Math.min(PRICE_RAMP.length - 2, Math.floor(f));
  const [a, c] = [rgb(PRICE_RAMP[i]), rgb(PRICE_RAMP[i + 1])];
  return `#${a.map((v, k) => Math.round(v + (c[k] - v) * (f - i)).toString(16).padStart(2, '0')).join('')}`;
}
