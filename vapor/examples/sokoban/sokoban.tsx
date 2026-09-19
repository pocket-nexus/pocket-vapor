// POCKET SOKOBAN — slice P2①: board, movement, level-1 load.
//
// Same two-life design as todo.tsx: under the oracle this runs unmodified on
// real Vue Vapor; the Pocket Vapor compiler lowers it to C for GBA/GB/NES/
// ESP32/Playdate. The board is 8 pooled STRING records (one 10-char row
// each, NES's pool cap is exactly 8). Walls and goals are the static
// terrain read from the flat LEVEL_ROM const (sokoban/levels.ts); the
// player and boxes are written in place with putChar. Cell reads go
// through the pure number helpers cellKind/isGoal so the reactive graph
// stays untouched while a move is being classified.
//
// This slice: load slot 1, arrows move/push, wall/box blocking, title line
// (level number + move count) and help/credit lines. Undo, restart, level
// select and the SOLVED banner arrive in the next slice.
//
// Controls: Up/Down/Left/Right move; a box directly ahead is pushed when
// the cell beyond it is empty or a goal. Walls and stopped boxes block the
// move and do not count as a move.

import { ref, computed } from "vue";
import { Button, onButton } from "../../host/input.ts";
import { SCREEN } from "../../host/screen.ts";
import { putChar } from "../../host/text.ts";
import { withCapacity } from "../../host/list.ts";
import { BW, BH, STRIDE, LEVEL_ROM } from "./levels.ts";

interface Line {
  text: string;
}

type Keymap = Record<number, () => void>;

const SLOT = 0; // slice P2①: only slot 1 (Microban #1) is loaded
const BOARD_Y = 2;
// The row `x` attribute folds only through constNum (no ternaries). A
// child-string ternary DOES fold — compileExpr keeps the constant-SCREEN
// branch and drops the other — so the per-screen origin (PD 20 / GBA 10 /
// NES 6 / GB 5) is a leading pad child rather than an x= offset.
const PAD_50 = "                    ";
const PAD_30 = "          ";
const PAD_22 = "      ";
const PAD_20 = "     ";
const WIDE = SCREEN.width >= 30;
const HELP_Y = SCREEN.height - 1;
const CREDIT_Y = SCREEN.height - 2;

// ---- UI components ----------------------------------------------------------

function TitleBar(props: { line: number; moves: number }) {
  return (
    <row y={props.line} class="bg-emerald-500 text-slate-950 align-center">
      {WIDE ? "SOKOBAN 01/24  MOVES " : "SOKOBAN 01/24 M"}
      {props.moves}
    </row>
  );
}

function CreditLine(props: { line: number }) {
  return (
    <row y={props.line} class="text-slate-500 align-center">
      {WIDE ? "MICROBAN (C) DAVID W. SKINNER" : "(C) D.W. SKINNER"}
    </row>
  );
}

function HelpBar(props: { line: number }) {
  return (
    <row y={props.line} x={1} class="text-slate-500">
      {WIDE ? "^v<> MOVE  PUSH THE BOXES" : "^v<> MOVE"}
    </row>
  );
}

// ---- app --------------------------------------------------------------------

export default () => {
  // Slot 1 (Microban #1) as it sits in its centred 10x8 ROM block. The seed
  // is the mutable dynamic layer; LEVEL_ROM stays the immutable terrain.
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
  const px = ref(4);
  const py = ref(3);
  const moves = ref(0);

  // Classify a DYNAMIC board cell: 1 wall, 2 box ($ or *), 0 enterable.
  // Pure: reads only, so it compiles to one s32 function with no dirty bit.
  // The length guard is required — an out-of-range record-string read
  // returns space on device but undefined under real Vue.
  function cellKind(x: number, y: number): number {
    if (x >= 0 && y >= 0 && x < BW && y < BH) {
      const line = rows.value[y];
      // char locals are not in the subset — the three classifiers are
      // inlined char comparisons (each compiles to a C char constant).
      if (line && x < line.text.length) {
        if (line.text[x] === "#") return 1;
        if (line.text[x] === "$" || line.text[x] === "*") return 2;
      }
    }
    return 0;
  }

  // Classify the STATIC terrain: 1 goal cell (. target, * box-on-goal,
  // + player-on-goal), 0 plain floor/void.
  function isGoal(x: number, y: number): number {
    if (x >= 0 && y >= 0 && x < BW && y < BH) {
      const off = SLOT * STRIDE + y * BW + x;
      if (LEVEL_ROM[off] === "." || LEVEL_ROM[off] === "*" || LEVEL_ROM[off] === "+") return 1;
    }
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

  function step(dx: number, dy: number): void {
    const nx = px.value + dx;
    const ny = py.value + dy;
    const ahead = cellKind(nx, ny);
    if (ahead === 1) return; // wall
    if (ahead === 2) {
      const bx = nx + dx;
      const by = ny + dy;
      if (cellKind(bx, by) !== 0) return; // box blocked by box/wall/edge
      paintFloor(nx, ny);
      paintBox(bx, by);
    }
    paintFloor(px.value, py.value);
    paintPlayer(nx, ny);
    px.value = nx;
    py.value = ny;
    moves.value = moves.value + 1;
  }

  const keys: Keymap = {
    [Button.Up]: () => step(0, -1),
    [Button.Down]: () => step(0, 1),
    [Button.Left]: () => step(-1, 0),
    [Button.Right]: () => step(1, 0),
  };
  onButton((b) => keys[b]?.());

  return (
    <>
      <TitleBar line={0} moves={moves.value} />
      {rows.value.map((r, i) => (
        <row y={BOARD_Y + i}>{SCREEN.width === 50 ? PAD_50 : SCREEN.width === 30 ? PAD_30 : SCREEN.width === 22 ? PAD_22 : PAD_20}{r.text}</row>
      ))}
      <CreditLine line={CREDIT_Y} />
      <HelpBar line={HELP_Y} />
    </>
  );
};
