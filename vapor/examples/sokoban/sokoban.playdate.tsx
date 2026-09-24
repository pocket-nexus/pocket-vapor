// POCKET SOKOBAN — PLAYDATE INPUT VARIANT (slice P2④).
//
// Same game as sokoban.tsx on the Playdate's six physical buttons plus the
// crank. The console file binds undo to B, restart to Start and the chooser
// to Select; Playdate has no Start/Select/L/R (VT101 rejects any static
// reference to them), so the missing controls land like this (S2 §3.2):
//
//   MOVE:    d-pad move/push, B undo, A open the level chooser,
//            CRANK = undo/redo scrub — one 45-degree detent per step,
//            anti-clockwise undo, clockwise REDO. Redo is Playdate-only:
//            the console tape never references an axis the consoles lack.
//            The redo stack is cleared by any effective d-pad move/push.
//            A sub-detent crank remainder belongs to one continuous gesture:
//            it is dropped on every mode change (chooser open/cancel,
//            solving, next-level) and on every effective d-pad step, so a
//            near-detent accumulated in one mode can never fire in another.
//            B undo is the same undo gesture as anti-clockwise rotation, so
//            it deliberately keeps the remainder.
//   SELECT:  d-pad (and crank detents) move the cursor with 24<->1 wrap,
//            A confirms, B cancels. Restart is two deliberate presses:
//            A opens the chooser on the current slot and A confirms it,
//            and loading the current slot rebuilds it.
//   SOLVED:  A loads the next level; every other input, the crank included,
//            is frozen.
//
// SHARING WITH sokoban.tsx: record shapes (Line/Hist), geometry and pads
// come from ./shared.ts and the 24-level LEVEL_ROM comes from ./levels.ts
// (both P1-d local const modules). The rule helpers below are duplicated
// text: module helpers are void, take only `:number` params and may touch
// neither refs nor host APIs, so the ref/putChar-driven rules cannot be
// lifted into a module without a further compiler extension. shared.ts
// records that boundary; oracle tests pin both entries to the same
// movement semantics.
//
// No Playdate SDK is installed in this environment: this file is proven by
// the compile-time admission check (check: playdate OK, no VT101) and the
// generated C; it has NOT been built with pdc or run on a device.

import { ref, computed } from "vue";
import {
  Button,
  onAxisDelta,
  onButton,
  RelativeAxis,
  RelativeAxisUnits,
} from "../../host/input.ts";
import { SCREEN } from "../../host/screen.ts";
import { putChar } from "../../host/text.ts";
import { withCapacity } from "../../host/list.ts";
import { BW, BH, STRIDE, LEVEL_COUNT, LEVEL_ROM } from "./levels.ts";
import {
  BOARD_Y,
  BANNER_Y,
  PROMPT_Y,
  HIST_CAP,
  PAD_50,
  PAD_30,
  PAD_22,
  PAD_20,
  type Line,
  type Hist,
} from "./shared.ts";

type Keymap = Record<number, () => void>;

const WIDE = SCREEN.width >= 30;
const HELP_Y = SCREEN.height - 1;
const CREDIT_Y = SCREEN.height - 2;
// One crank detent is 45 degrees; signed millidegrees are the canonical axis
// unit. The app owns the detent, the host only preserves rotation.
const CRANK_DETENT = 45 * RelativeAxisUnits.PerDegree;

// ---- app --------------------------------------------------------------------

export default () => {
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
  const hist = ref<Hist[]>(withCapacity([], HIST_CAP));
  // Playdate-only forward stack: crank anti-clockwise pops `hist` onto it,
  // clockwise replays from it. Same packed one-byte step records.
  const redone = ref<Hist[]>(withCapacity([], HIST_CAP));
  const px = ref(4);
  const py = ref(3);
  const moves = ref(0);
  const slot = ref(0);
  const mode = ref(0); // 0 MOVE, 1 SELECT (chooser), 2 SOLVED
  const cursor = ref(0);
  const loose = ref(1);
  const crankRemainder = ref(0); // sub-detent millidegrees carried frames

  // The sub-detent crank remainder belongs to one continuous gesture.
  // Every effective d-pad step and every mode/level boundary ends that
  // gesture, and they all end it here so a near-detent can never survive an
  // input transition. B undo is deliberately routed around this: it is the
  // same gesture as anti-clockwise rotation.
  function newGesture(): void {
    crankRemainder.value = 0;
  }

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

  function isGoal(x: number, y: number): number {
    if (x >= 0 && y >= 0 && x < BW && y < BH) {
      const off = slot.value * STRIDE + y * BW + x;
      if (LEVEL_ROM[off] === "." || LEVEL_ROM[off] === "*" || LEVEL_ROM[off] === "+") return 1;
    }
    return 0;
  }

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

  function loadLevel(s: number): void {
    slot.value = s;
    moves.value = 0;
    mode.value = 0;
    loose.value = 0;
    hist.value = hist.value.slice(0, 0);
    redone.value = redone.value.slice(0, 0);
    // A level load (confirm, restart or A-next) starts a fresh interaction.
    newGesture();
    for (let y = 0; y < BH; y++) {
      const line = rows.value[y];
      if (line) {
        for (let x = 0; x < BW; x++) {
          const off = s * STRIDE + y * BW + x;
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

  // Apply one already-vetted movement (shared by live d-pad steps and crank
  // redo). nx/ny are in bounds and enterable; pushed says whether a box at
  // nx,ny moves to bx,by.
  function commitMove(dx: number, dy: number, pushed: number): void {
    const nx = px.value + dx;
    const ny = py.value + dy;
    if (pushed === 1) {
      const bx = nx + dx;
      const by = ny + dy;
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
  }

  function step(dx: number, dy: number, dc: number): void {
    const nx = px.value + dx;
    const ny = py.value + dy;
    const ahead = cellKind(nx, ny);
    if (ahead === 1) return;
    const pushed = ahead === 2 ? 1 : 0;
    if (pushed === 1) {
      if (cellKind(nx + dx, ny + dy) !== 0) return;
    }
    // Full-history policy, identical to the console build: a legal move at
    // the cap is refused before anything changes, so 64 crank/B undos still
    // restore the level's start exactly.
    if (hist.value.length >= HIST_CAP) return;
    commitMove(dx, dy, pushed);
    // A self-powered step starts a new interaction: the crank gesture armed
    // before it must not act on the history this step just wrote.
    newGesture();
    const code: any = dc + pushed * 8;
    hist.value.push({ c: code });
    // Moving under your own power invalidates the redo branch, like every
    // editor's undo/redo stack.
    redone.value = redone.value.slice(0, 0);
    if (loose.value === 0) {
      // Solving is a mode boundary: the frozen-SOLVED handler ignores the
      // crank, and leaving it armed would leak into chooser/next-level.
      newGesture();
      mode.value = 2;
    }
  }

  function undo(): void {
    if (mode.value !== 0) return;
    if (hist.value.length === 0) return;
    const top = hist.value[hist.value.length - 1];
    if (top) {
      const code: any = top.c;
      const dx = stepDx(code);
      const dy = stepDy(code);
      const pushed = stepPushed(code);
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
      // The reversed step becomes available to clockwise redo.
      redone.value.push({ c: code });
      hist.value.splice(hist.value.length - 1, 1);
    }
  }

  // Replay one undone packed step. History only ever records legal moves and
  // undo exactly reverses them, so the replayed collision gates cannot fail;
  // redone being non-empty likewise guarantees hist.length < HIST_CAP.
  function redo(): void {
    if (mode.value !== 0) return;
    if (redone.value.length === 0) return;
    const top = redone.value[redone.value.length - 1];
    if (top) {
      const code: any = top.c;
      commitMove(stepDx(code), stepDy(code), stepPushed(code));
      hist.value.push({ c: code });
      redone.value.splice(redone.value.length - 1, 1);
      if (loose.value === 0) {
        // Solving is a mode boundary: the frozen-SOLVED handler ignores the
        // crank, and leaving it armed would leak into chooser/next-level.
        newGesture();
        mode.value = 2;
      }
    }
  }

  function openChooser(): void {
    cursor.value = slot.value;
    // Entering the chooser starts a new gesture; a MOVE-mode remainder must
    // not step the cursor on the next millidegree.
    newGesture();
    mode.value = 1;
  }
  function cancelChooser(): void {
    newGesture();
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
  function advance(): void {
    if (slot.value === LEVEL_COUNT - 1) {
      cursor.value = slot.value;
      // A mode boundary out of SOLVED: a MOVE-mode near-detent must not wrap
      // the cursor the moment the chooser appears.
      newGesture();
      mode.value = 1;
    } else {
      loadLevel(slot.value + 1);
    }
  }

  // Single entry for every effective d-pad direction step, in both MOVE and
  // SELECT, so the gesture boundary lives in one place instead of being
  // re-cleared at each call site. In SELECT a cursor step is always
  // effective, so it starts a new gesture before moving. In MOVE the step is
  // effective only once step() passes the wall/history gates, so step() owns
  // the newGesture() call and a wall bump keeps the remainder. The crank
  // detent loop deliberately does NOT route through here: a detent continues
  // the same gesture, so it calls moveCursor/undo/redo directly.
  function dpadStep(code: number): void {
    if (mode.value === 1) {
      newGesture();
      if (code === 1 || code === 2) moveCursor(-1);
      else moveCursor(1);
    } else {
      if (code === 1) step(0, -1, 1);
      else if (code === 2) step(-1, 0, 2);
      else if (code === 3) step(0, 1, 3);
      else step(1, 0, 4);
    }
  }

  const moveKeys: Keymap = {
    [Button.Up]: () => dpadStep(1),
    [Button.Left]: () => dpadStep(2),
    [Button.Down]: () => dpadStep(3),
    [Button.Right]: () => dpadStep(4),
    [Button.B]: undo,
    [Button.A]: openChooser,
  };
  const selectKeys: Keymap = {
    [Button.Left]: () => dpadStep(2),
    [Button.Up]: () => dpadStep(1),
    [Button.Right]: () => dpadStep(4),
    [Button.Down]: () => dpadStep(3),
    [Button.A]: confirmChooser,
    [Button.B]: cancelChooser,
  };
  const solvedKeys: Keymap = {
    [Button.A]: advance,
  };
  onButton((b) => (mode.value === 2 ? solvedKeys : mode.value === 1 ? selectKeys : moveKeys)[b]?.());

  // Crank: in MOVE the detents scrub undo (anti-clockwise) and redo
  // (clockwise); in the chooser they step the cursor (wrap handled per
  // detent); SOLVED ignores rotation entirely. Sub-45-degree motion stays in
  // crankRemainder, so two 30-degree ticks make one step.
  onAxisDelta(RelativeAxis.Primary, (delta) => {
    if (mode.value !== 2) {
      crankRemainder.value = crankRemainder.value + delta;
      const steps = Math.trunc(crankRemainder.value / CRANK_DETENT);
      if (steps !== 0) {
        crankRemainder.value = crankRemainder.value % CRANK_DETENT;
        if (mode.value === 1) {
          if (steps > 0) {
            for (let i = 0; i < steps; i++) moveCursor(1);
          } else {
            for (let i = 0; i < 0 - steps; i++) moveCursor(-1);
          }
        } else {
          if (steps > 0) {
            for (let i = 0; i < steps; i++) redo();
          } else {
            for (let i = 0; i < 0 - steps; i++) undo();
          }
        }
      }
    }
  });

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

      {mode.value === 0 && hist.value.length >= HIST_CAP ? (
        <row y={10} class="bg-amber-300 text-slate-950 align-center">
          {WIDE ? "HISTORY FULL - TURN CRANK OR PRESS B TO UNDO" : "HIST FULL"}
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
        {/* WIDE literal must fit 49 cells (starts at x=1 of the 50-column screen) */}
        {WIDE ? "DPAD MOVE  B UNDO  CRANK -/+ UNDO REDO  A LEVELS" : "B:UND A:LVL CR:UD"}
      </row>
    </>
  );
};
