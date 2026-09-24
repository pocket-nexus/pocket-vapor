// vapor/examples/sokoban/shared.ts — constants and record shapes shared by
// the console build (sokoban.tsx: GBA/GB/NES/ESP32) and the Playdate input
// variant (sokoban.playdate.tsx).
//
// WHY A DATA MODULE, NOT A LOGIC MODULE: the P1-d local-const import only
// admits compile-time data (number / string / string[] / {name:number}),
// exported interfaces, and void helpers whose params are all `: number` and
// whose bodies touch neither refs nor host APIs (compile.ts scanModule*).
// Sokoban's rules live on refs (rows/px/py/moves/mode/hist) and host calls
// (putChar, onButton), so step/undo/loadLevel/... cannot be lifted into a
// module as-is; a shared RULES MODULE would need a further compiler
// extension (module helpers over record/ref state). That is deliberately
// out of scope for the game slices. What IS shared, verbatim, is every
// fixed datum the two entry files would otherwise copy:
//   - record shapes Line (a board row) and Hist (a packed undo step),
//   - board/banner geometry and the 64-step history capacity,
//   - the per-screen leading pads that centre the 10-wide board.
// Screen-derived values (WIDE, HELP_Y/CREDIT_Y off SCREEN.*) stay in each
// entry because imported modules cannot read host/screen. The level data is
// already its own module (levels.ts).

export interface Line {
  text: string;
}

// One narrow history record. The field is declared `boolean` so each record
// is a single u8 on every target; it actually carries the packed step code
// (1..4 direction, +8 when a box was pushed). Number<->boolean has no shared
// TS type, so the packed value crosses through `: any` locals (erased by
// both tsc and the AOT compiler); on device push stores the raw u8 and the
// pure decoders in each entry read it back with arithmetic.
export interface Hist {
  c: boolean;
}

export const BOARD_Y = 2;
export const BANNER_Y = 11;
export const PROMPT_Y = 12;
// Fixed depth of the undo pool (withCapacity in each entry). The
// full-history policy refuses the 65th recorded move, so the app itself
// never lets the bounded pool overflow; VP_TRIP_POOL_FULL cannot fire from
// a legal game.
export const HIST_CAP = 64;
// The per-screen board origin (PD 20 / GBA 10 / NES 6 / GB 5) is a leading
// pad child rather than an x= offset (the x attribute folds constants only).
export const PAD_50 = "                    ";
export const PAD_30 = "          ";
export const PAD_22 = "      ";
export const PAD_20 = "     ";
