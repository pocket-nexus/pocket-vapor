// vapor/host/list.ts — the amphibious static-capacity annotation for lists.
//
//   const hist = ref<Hist[]>(withCapacity([], 64));
//
// One call, two lives:
//
// Under the oracle (real Vue Vapor on a JS host) this file executes:
// withCapacity is the identity — it returns the seed array untouched, so
// list semantics are exactly JavaScript's and growth is unbounded.
//
// The Pocket Vapor compiler never executes this file. It recognizes the
// call only as the direct seed of ref<T[]>(...) and uses `capacity` as the
// pool's STATIC element capacity on every target: the C array backing the
// list is declared with that many records, the push guard compares against
// it, and every view derived from the list is sized to it. Without the
// annotation a list keeps the target default (poolCap: 8 on NES, 32 on the
// gcc/SDCC targets), so apps that never ask for more pay nothing.
//
// Capacity is per list: a 12-row board and a 64-deep undo stack no longer
// share one global cap, and the small pools stay small. Pushing past the
// declared capacity keeps firing VP_TRIP_POOL_FULL (never UB).

/**
 * Declare the static backing capacity of a `ref<T[]>` list. Returns the
 * seed array unchanged under the oracle; the compiler reads the literal
 * and never emits a call.
 */
export function withCapacity<T>(seed: T[], capacity: number): T[] {
  return seed;
}
