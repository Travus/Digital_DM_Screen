/**
 * Shared search matching for every filterable list in the app.
 *
 * Exact substring matching is the primary behaviour and always wins: a DM who
 * types `frig` expects Frightened, and nothing surprising alongside it. Typo
 * tolerance is a **fallback**, used only when the exact pass finds nothing at
 * all, so a working search can never suddenly gain noisy extra rows.
 *
 * The fallback is approximate *substring* matching, not whole-string: `quck`
 * has to find "Quickened Spell", and a whole-string edit distance between those
 * two is enormous. So the distance is measured against the best-matching window
 * anywhere inside the name — free start and free end — which is Sellers'
 * variant of Levenshtein. Adjacent transpositions count as one edit (the
 * Damerau part), because `teh` for `the` is the single most common typo there
 * is and two edits would put it out of reach.
 */

/**
 * How far a query may stray, by its length. Short queries are deliberately
 * given no latitude at all: at three characters almost everything is within one
 * edit of almost everything else, and the result would be a list that looks
 * broken rather than helpful.
 */
function maxDistanceFor(length: number): number {
  if (length < 4) return 0
  if (length < 7) return 1
  return 2
}

/**
 * Smallest number of edits turning `query` into *any* substring of `text`.
 *
 * Standard Levenshtein with two changes: row 0 is all zeros so a match may
 * start anywhere in `text`, and the answer is the minimum of the final row so
 * it may end anywhere. Both strings must already be lowercased.
 */
function substringDistance(query: string, text: string): number {
  // Two rolling rows rather than a full matrix — names are short, but this runs
  // over every entry on every keystroke.
  let previous = new Array<number>(text.length + 1).fill(0)
  let beforePrevious = new Array<number>(text.length + 1).fill(0)
  let current = new Array<number>(text.length + 1).fill(0)

  for (let q = 1; q <= query.length; q++) {
    current[0] = q
    for (let t = 1; t <= text.length; t++) {
      const substitutionCost = query[q - 1] === text[t - 1] ? 0 : 1
      let best = Math.min(
        previous[t] + 1, // delete from query
        current[t - 1] + 1, // insert into query
        previous[t - 1] + substitutionCost
      )
      // Adjacent transposition, e.g. "hte" against "the".
      if (
        q > 1 &&
        t > 1 &&
        query[q - 1] === text[t - 2] &&
        query[q - 2] === text[t - 1] &&
        beforePrevious[t - 2] + 1 < best
      ) {
        best = beforePrevious[t - 2] + 1
      }
      current[t] = best
    }
    beforePrevious = previous
    previous = current
    current = new Array<number>(text.length + 1).fill(0)
  }

  return Math.min(...previous)
}

/** Ranked below every exact match, and above nothing. */
export const FUZZY_RANK = 1
/** An exact substring hit. */
export const EXACT_RANK = 0

export interface Match {
  /** EXACT_RANK or FUZZY_RANK — sort ascending so exact hits lead. */
  rank: number
  /** Edit distance for a fuzzy hit, 0 for an exact one. Ties break by input order. */
  distance: number
}

/**
 * Scores one candidate against an already-lowercased, already-trimmed query.
 * Returns null when it does not match at all.
 *
 * `allowFuzzy` is false on the first pass so callers can find out whether any
 * exact match exists before paying for the distance calculation.
 */
export function matchText(query: string, text: string, allowFuzzy: boolean): Match | null {
  const haystack = text.toLowerCase()
  if (haystack.includes(query)) return { rank: EXACT_RANK, distance: 0 }
  if (!allowFuzzy) return null

  const limit = maxDistanceFor(query.length)
  if (limit === 0) return null

  const distance = substringDistance(query, haystack)
  return distance <= limit ? { rank: FUZZY_RANK, distance } : null
}

/**
 * Filters `items` by `query`, exact first and typo-tolerant only if that found
 * nothing. Input order is preserved within a rank, so the result is stable and
 * a caller's own ordering (favourites pinned first, category grouping) survives.
 *
 * `text` returns the field to match on. Callers wanting to match several fields
 * exactly but only one fuzzily should filter those themselves and use this for
 * the fuzzy field — see `ModulePicker`.
 */
export function searchFilter<T>(
  query: string,
  items: readonly T[],
  text: (item: T) => string
): T[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...items]

  const exact = items.filter((item) => matchText(needle, text(item), false))
  if (exact.length > 0) return exact

  const fuzzy: { item: T; distance: number }[] = []
  for (const item of items) {
    const match = matchText(needle, text(item), true)
    if (match) fuzzy.push({ item, distance: match.distance })
  }
  // Closest first; input order decides ties, so results never reshuffle.
  return fuzzy
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
    .map((entry) => entry.item)
}
