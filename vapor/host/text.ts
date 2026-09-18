// vapor/host/text.ts — the amphibious one-character string editor.
//
// One call, two implementations of the same semantics:
//
//   line.text = putChar(line.text, x, ch)
//
// Under the oracle this file executes: putChar is a pure function that
// returns a NEW string with byte `x` replaced, matching JS string
// immutability (a direct `line.text[x] = ch` would silently no-op in real
// Vue, which is why indexed assignment is not part of the subset). Assigning
// the result back mutates the (deeply reactive) record field, so Vue's
// list effect re-renders exactly as the device's vp_mark(list) does.
//
// The Pocket Vapor compiler never executes this file. It recognizes the
// exact assignment shape and lowers it to one in-place byte store,
// vp_sb_put(&line->text, x, ch), gated on the byte actually changing — no
// slice temps, no overlay slot. Out-of-range indices leave the string
// unchanged on both sides.
//
// ASCII only, like the rest of the string subset.

/**
 * Return `s` with the character at `i` replaced by `ch`. Returns `s`
 * unchanged when `i` is out of range. `ch` must be exactly one character.
 */
export function putChar(s: string, i: number, ch: string): string {
  if (ch.length !== 1) {
    throw new Error(`putChar: ch must be exactly one character, got ${JSON.stringify(ch)}`);
  }
  if (i < 0 || i >= s.length) return s;
  return s.slice(0, i) + ch + s.slice(i + 1);
}
