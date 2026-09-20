// POCKET SOKOBAN — slice P2②: undo, level select, solve detection.
//
// Same two-life design as todo.tsx: under the oracle this runs unmodified on
// real Vue Vapor; the Pocket Vapor compiler lowers it to C for GBA/GB/NES/
// ESP32/Playdate. The board is 8 pooled STRING records (one 10-char row
// each, NES's board pool holds exactly 8). Walls and goals are the static
// terrain read from the flat LEVEL_ROM const (sokoban/levels.ts); the
// player and boxes are written in place with putChar.
//
// This slice adds, on top of P2①'s board/movement:
//   - UNDO: B reverses one move, pulling a pushed box back with the player.
//     The history is a second pooled list of ONE-BYTE records (a single
//     u8 field): 3 bits per step — a direction code 1..4 plus a push flag
//     (add 8). A 64-deep stack then costs 65 B on NES, the only shape that
//     links beside the 8-row string board in the 6502 BSS window.
//   - LEVEL SELECT: Select opens a chooser; Left/Up/L step -1 and
//     Right/Down/R step +1 with 24<->1 wrap; A/Start load the picked slot
//     (picking the current slot restarts it), B/Select cancel. Start in
//     play restarts the current level; the board is rebuilt cell-by-cell
//     from LEVEL_ROM.
//   - SOLVED: a count of boxes still off a goal drives the SOLVED banner;
//     in SOLVED every button but A is frozen, and A loads the next level
//     (after the last level it returns to the chooser).
//
// Three keymaps (MOVE / SELECT / SOLVED) are selected per press by mode.
//
// Controls (play): Up/Down/Left/Right move/push, B undo, Start restart,
// Select open the chooser.

import { ref, computed } from "vue";
import { Button, onButton } from "../../host/input.ts";
import { SCREEN } from "../../host/screen.ts";
import { putChar } from "../../host/text.ts";
import { withCapacity } from "../../host/list.ts";
import { BW, BH, STRIDE, LEVEL_COUNT, LEVEL_ROM } from "./levels.ts";

interface Line {
  text: string;
}

// One narrow history record. The field is declared `boolean` so each record
// is a single u8 on every target; it actually carries the packed step code
// (1..4 direction, +8 when a box was pushed). Number<->boolean has no shared
// TS type, so the packed value crosses through `: any` locals (erased by
// both tsc and the AOT compiler); on device push stores the raw u8 and the
// pure decoders below read it back with arithmetic.
interface Hist {
  c: boolean;
}

type Keymap = Record<number, () => void>;

const BOARD_Y = 2;
const BANNER_Y = 11;
const PROMPT_Y = 12;
// The per-screen board origin (PD 20 / GBA 10 / NES 6 / GB 5) is a leading
// pad child rather than an x= offset (the x attribute folds constants only).
const PAD_50 = "                    ";
const PAD_30 = "          ";
const PAD_22 = "      ";
const PAD_20 = "     ";
const WIDE = SCREEN.width >= 30;
const HELP_Y = SCREEN.height - 1;
const CREDIT_Y = SCREEN.height - 2;

// ---- app --------------------------------------------------------------------

export default () => {
  // Slot 1 (Microban #1) as it sits in its centred 10x8 ROM block. The seed
  // is the mutable dynamic layer for boot only; loadLevel() rebuilds it from
  // LEVEL_ROM for every restart/select/advance.
  const rows = ref<Line[]>(
    withCapacity(
      [
        { text: "  ####    " },
        { text: "  # .#    " },
        { text: "  #  ###  " },
        { text: "  #*@  #  " },
        { text: "  #  $ #  " },
        { text: "  #  ###  " },
        { text: "  ####    " },
        { text: "          " },
      ],
      BH,
    ),
  );
  const hist = ref<Hist[]>(withCapacity([], 64));
  const px = ref(4);
  const py = ref(3);
  const moves = ref(0);
  const slot = ref(0); // 0-based play slot
  const mode = ref(0); // 0 MOVE, 1 SELECT (chooser), 2 SOLVED
  const cursor = ref(0); // chooser slot
  const loose = ref(1); // boxes not yet on a goal; 0 == solved

  // Classify a DYNAMIC board cell: 1 wall, 2 box ($ or *), 0 enterable.
  // Pure: reads only, so it compiles to one s32 function with no dirty bit.
  function cellKind(x: number, y: number): number {
    if (x >= 0 && y >= 0 && x < BW && y < BH) {
      const line = rows.value[y];
      if (line && x < line.text.length) {
        if (line.text[x] === "#") return 1;
        if (line.text[x] === "$" || line.text[x] === "*") return 2;
      }
    }
    return 0;
  }

  // Classify the STATIC terrain: 1 goal cell (. * +), 0 plain floor/void.
  function isGoal(x: number, y: number): number {
    if (x >= 0 && y >= 0 && x < BW && y < BH) {
      const off = slot.value * STRIDE + y * BW + x;
      if (LEVEL_ROM[off] === "." || LEVEL_ROM[off] === "*" || LEVEL_ROM[off] === "+") return 1;
    }
    return 0;
  }

  // Decode a packed history byte. Pure arithmetic, no reactive graph.
  function stepDx(code: number): number {
    const d = code % 8;
    if (d === 2) return -1;
    if (d === 4) return 1;
    return 0;
  }
  function stepDy(code: number): number {
    const d = code % 8;
    if (d === 1) return -1;
    if (d === 3) return 1;
    return 0;
  }
  function stepPushed(code: number): number {
    if (code >= 8) return 1;
    return 0;
  }

  function paintFloor(x: number, y: number): void {
    const line = rows.value[y];
    if (line) {
      if (isGoal(x, y) === 1) line.text = putChar(line.text, x, ".");
      else line.text = putChar(line.text, x, " ");
    }
  }

  function paintBox(x: number, y: number): void {
    const line = rows.value[y];
    if (line) {
      if (isGoal(x, y) === 1) line.text = putChar(line.text, x, "*");
      else line.text = putChar(line.text, x, "$");
    }
  }

  function paintPlayer(x: number, y: number): void {
    const line = rows.value[y];
    if (line) {
      if (isGoal(x, y) === 1) line.text = putChar(line.text, x, "+");
      else line.text = putChar(line.text, x, "@");
    }
  }

  // Rebuild the board for slot s from LEVEL_ROM. Canonical for-loops with
  // putChar only (string clear/concat are outside the subset); the rows are
  // pre-seeded to ten spaces so every byte index is in range. The same pass
  // locates the player and counts boxes off a goal.
  function loadLevel(s: number): void {
    slot.value = s;
    moves.value = 0;
    mode.value = 0;
    loose.value = 0;
    hist.value = hist.value.slice(0, 0);
    for (let y = 0; y < BH; y++) {
      const line = rows.value[y];
      if (line) {
        for (let x = 0; x < BW; x++) {
          const off = s * STRIDE + y * BW + x;
          // char locals are outside the subset; the ROM byte is indexed
          // inline (putChar takes a char; char-vs-literal compares lower to
          // C char constants).
          line.text = putChar(line.text, x, LEVEL_ROM[off]);
          if (LEVEL_ROM[off] === "@" || LEVEL_ROM[off] === "+") {
            px.value = x;
            py.value = y;
          } else if (LEVEL_ROM[off] === "$") {
            loose.value = loose.value + 1;
          }
        }
      }
    }
  }

  function step(dx: number, dy: number, dc: number): void {
    const nx = px.value + dx;
    const ny = py.value + dy;
    const ahead = cellKind(nx, ny);
    if (ahead === 1) return; // wall
    const pushed = ahead === 2 ? 1 : 0;
    if (pushed === 1) {
      const bx = nx + dx;
      const by = ny + dy;
      if (cellKind(bx, by) !== 0) return; // box blocked by box/wall/edge
      // Track the pushed box against goal terrain (the loose count only
      // changes when a box crosses onto/off a goal).
      const boxWasLoose = isGoal(nx, ny) === 1 ? 0 : 1;
      const boxNowLoose = isGoal(bx, by) === 1 ? 0 : 1;
      loose.value = loose.value + boxNowLoose - boxWasLoose;
      paintFloor(nx, ny);
      paintBox(bx, by);
    }
    paintFloor(px.value, py.value);
    paintPlayer(nx, ny);
    px.value = nx;
    py.value = ny;
    moves.value = moves.value + 1;
    const code: any = dc + pushed * 8;
    hist.value.push({ c: code });
    if (loose.value === 0) mode.value = 2;
  }

  function undo(): void {
    if (mode.value !== 0) return; // frozen while solved; chooser handles B itself
    if (hist.value.length === 0) return;
    const top = hist.value[hist.value.length - 1];
    if (top) {
      const code: any = top.c;
      const dx = stepDx(code);
      const dy = stepDy(code);
      const pushed = stepPushed(code);
      // Player stands where the box was pushed to-adjacent; reverse the
      // move: free the player cell, pull the box back if pushed, then move
      // the player to the cell behind.
      paintFloor(px.value, py.value);
      if (pushed === 1) {
        const boxX = px.value + dx;
        const boxY = py.value + dy;
        const boxWasLoose = isGoal(px.value, py.value) === 1 ? 0 : 1;
        const boxNowLoose = isGoal(boxX, boxY) === 1 ? 0 : 1;
        loose.value = loose.value + boxWasLoose - boxNowLoose;
        paintFloor(boxX, boxY);
        paintBox(px.value, py.value);
      }
      px.value = px.value - dx;
      py.value = py.value - dy;
      paintPlayer(px.value, py.value);
      moves.value = moves.value - 1;
      hist.value.splice(hist.value.length - 1, 1);
    }
  }

  function openChooser(): void {
    cursor.value = slot.value;
    mode.value = 1;
  }
  function cancelChooser(): void {
    mode.value = 0;
  }
  function moveCursor(d: number): void {
    const n = cursor.value + d;
    if (n < 0) cursor.value = LEVEL_COUNT - 1;
    else if (n >= LEVEL_COUNT) cursor.value = 0;
    else cursor.value = n;
  }
  function confirmChooser(): void {
    loadLevel(cursor.value);
  }
  function restart(): void {
    loadLevel(slot.value);
  }
  function advance(): void {
    if (slot.value === LEVEL_COUNT - 1) {
      // after the final level, return to the chooser
      cursor.value = slot.value;
      mode.value = 1;
    } else {
      loadLevel(slot.value + 1);
    }
  }

  const moveKeys: Keymap = {
    [Button.Up]: () => step(0, -1, 1),
    [Button.Left]: () => step(-1, 0, 2),
    [Button.Down]: () => step(0, 1, 3),
    [Button.Right]: () => step(1, 0, 4),
    [Button.B]: undo,
    [Button.Start]: restart,
    [Button.Select]: openChooser,
  };
  const selectKeys: Keymap = {
    [Button.Left]: () => moveCursor(-1),
    [Button.Up]: () => moveCursor(-1),
    [Button.L]: () => moveCursor(-1),
    [Button.Right]: () => moveCursor(1),
    [Button.Down]: () => moveCursor(1),
    [Button.R]: () => moveCursor(1),
    [Button.A]: confirmChooser,
    [Button.Start]: confirmChooser,
    [Button.B]: cancelChooser,
    [Button.Select]: cancelChooser,
  };
  const solvedKeys: Keymap = {
    [Button.A]: advance,
  };
  onButton((b) => (mode.value === 2 ? solvedKeys : mode.value === 1 ? selectKeys : moveKeys)[b]?.());

  return (
    <>
      {mode.value === 2 ? (
        <row y={0} class="bg-amber-300 text-slate-950 align-center">
          {WIDE ? "SOLVED IN " : "SOLVED "}
          {moves.value}
          {WIDE ? " MOVES" : " MOV"}
        </row>
      ) : null}
      {mode.value !== 2 ? (
        <row y={0} class="bg-emerald-500 text-slate-950 align-center">
          {"SOKOBAN "}
          {slot.value + 1 < 10 ? "0" : ""}
          {slot.value + 1}
          {"/"}
          {LEVEL_COUNT}
          {WIDE ? "  MOVES " : " M"}
          {moves.value}
        </row>
      ) : null}
      {rows.value.map((r, i) => (
        <row y={BOARD_Y + i}>{SCREEN.width === 50 ? PAD_50 : SCREEN.width === 30 ? PAD_30 : SCREEN.width === 22 ? PAD_22 : PAD_20}{r.text}</row>
      ))}

      {mode.value === 1 ? (
        <row y={BANNER_Y} class="bg-slate-100 text-slate-950 align-center">
          {WIDE ? "-- LEVEL " : "LEVEL "}
          {cursor.value + 1 < 10 ? "0" : ""}
          {cursor.value + 1}
          {"/"}
          {LEVEL_COUNT}
          {WIDE ? " --" : ""}
        </row>
      ) : null}
      {mode.value === 1 ? (
        <row y={PROMPT_Y} class="text-slate-400 align-center">
          {WIDE ? "<> CHOOSE  A:OK  B:BACK" : "<> PICK A OK B BACK"}
        </row>
      ) : null}

      {mode.value === 2 ? (
        <row y={PROMPT_Y} class="bg-amber-300 text-slate-950 align-center">
          {WIDE ? "PRESS A FOR NEXT LEVEL" : "PRESS A NEXT"}
        </row>
      ) : null}

      <row y={CREDIT_Y} class="text-slate-500 align-center">
        {WIDE ? "MICROBAN (C) DAVID W. SKINNER" : "(C) D.W. SKINNER"}
      </row>
      <row y={HELP_Y} x={1} class="text-slate-500">
        {WIDE ? "^v<>MOVE B:UNDO ST:RST SEL:LVL" : "B:UND ST:RST SE:LVL"}
      </row>
    </>
  );
};
