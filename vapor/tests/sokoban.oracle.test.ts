// vapor/tests/sokoban.oracle.test.ts — Pocket Sokoban (slice P2②: undo,
// level select, solve) under real Vue Vapor. Every rule in the slice has a
// case; the three-console cell-for-cell replay lives in parity.test.ts.
//
// Coverage: boot layout; walking/pushing/blocking (kept from P2①); undo of a
// walk, of a non-goal push (box pulled back) and of a push that crossed onto
// a goal ('*' -> '.', '$' restored); undo to the empty bottom; blocked moves
// not being recorded; a 64-deep history; Start restart; the SELECT chooser
// (open, cursor step, two-way wrap, L/R shoulders, A and Start confirm, B
// and Select cancel, current-slot restart); solving flips to the SOLVED
// banner with two '*'; frozen controls while solved; A advancing through
// slots 2 and 3; and after the last level A returning to the chooser. The
// full 83-key tape is then checked press-by-press against an independent
// per-press model (moves/mode/slot arrays in sokoban-tape.ts).

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { compileVaporApp, type VaporTargetName } from "../compiler/compile.ts";
import { Button } from "../host/input.ts";
import { bootOracle, type Oracle } from "../oracle/boot.ts";
import { BW, BH, STRIDE, LEVEL_COUNT, LEVEL_ROM } from "../examples/sokoban/levels.ts";
import {
  SOKOBAN_TAPE,
  SOKOBAN_MOVES_AFTER,
  SOKOBAN_MODE_AFTER,
  SOKOBAN_SLOT_AFTER,
  SOKOBAN_HIST_BOUNDARY_TAPE,
} from "./sokoban-tape.ts";

const APP = join(import.meta.dir, "..", "examples", "sokoban", "sokoban.tsx");
const ENTRY = join(import.meta.dir, "..", "oracle", "entry-sokoban.ts");
const BOARD_Y = 2;
const BANNER_Y = 11;

const GEOMS = [
  { name: "gba", w: 30, h: 20, pad: 10, target: "gba" as VaporTargetName },
  { name: "gb", w: 20, h: 18, pad: 5, target: "gb" as VaporTargetName },
  { name: "nes", w: 22, h: 18, pad: 6, target: "nes" as VaporTargetName },
];

async function bootFor(g: (typeof GEOMS)[number]): Promise<Oracle> {
  const styles = compileVaporApp(APP, await Bun.file(APP).text(), "SOKOBAN", g.target).styles;
  return bootOracle({ width: g.w, height: g.h, styles, entry: ENTRY });
}

function board(o: Oracle, pad: number): string[] {
  return o.grid().chars.slice(BOARD_Y, BOARD_Y + BH).map((r) => r.slice(pad, pad + BW));
}
function cell(o: Oracle, pad: number, x: number, y: number): string {
  return o.grid().chars[BOARD_Y + y][pad + x];
}
function rowText(o: Oracle, y: number): string {
  return o.grid().chars[y];
}
function movesOf(o: Oracle): number {
  const m = rowText(o, 0).match(/(?:IN|MOVES|M)\s+(\d+)/);
  return m ? Number(m[1]) : -1;
}
function modeOf(o: Oracle): number {
  if (rowText(o, 0).includes("SOLVED")) return 2;
  if (rowText(o, BANNER_Y).includes("LEVEL")) return 1;
  return 0;
}
const count = (o: Oracle, pad: number, ch: string) =>
  board(o, pad).join("").split(ch).length - 1;

describe("sokoban boot and layout (three geometries)", () => {
  for (const g of GEOMS) {
    test(`${g.name}: title, credit, help and board match LEVEL_ROM slot 1`, async () => {
      const o = await bootFor(g);
      const screen = o.grid().chars;
      expect(screen[0]).toContain("SOKOBAN 01/24");
      expect(screen[0]).toMatch(g.w >= 30 ? /MOVES 0/ : /M0(?!\d)/);
      expect(modeOf(o)).toBe(0);
      expect(screen[g.h - 2]).toContain("SKINNER");
      // the wide help names the d-pad; narrow screens use the terse legend
      if (g.w >= 30) expect(screen[g.h - 1]).toContain("MOVE");
      else expect(screen[g.h - 1]).toContain("UND");
      const got = board(o, g.pad);
      for (let y = 0; y < BH; y++) expect(got[y]).toBe(LEVEL_ROM.slice(y * BW, y * BW + BW));
      o.unmount();
    });
  }
});

describe("sokoban movement (regression of P2① rules)", () => {
  async function boot() {
    const g = GEOMS[0];
    const o = await bootFor(g);
    return { o, pad: g.pad };
  }

  test("walking, goal '+'/'.' and a push onto a goal all paint correctly", async () => {
    const { o, pad } = await boot();
    await o.press(Button.Up);
    await o.press(Button.Up); // onto goal (4,1)
    expect(cell(o, pad, 4, 1)).toBe("+");
    await o.press(Button.Down);
    expect(cell(o, pad, 4, 1)).toBe(".");
    // first tape press: box-on-goal '*' cannot be pushed through the wall
    await o.press(Button.Start); // reset to a clean board first
    await o.press(Button.Left);
    expect(cell(o, pad, 3, 3)).toBe("*");
    expect(cell(o, pad, 4, 3)).toBe("@");
    expect(movesOf(o)).toBe(0);
    o.unmount();
  });
});

describe("sokoban undo", () => {
  async function boot() {
    const g = GEOMS[0];
    const o = await bootFor(g);
    return { o, pad: g.pad };
  }

  test("B reverses a plain walk and restores the goal glyph", async () => {
    const { o, pad } = await boot();
    await o.press(Button.Up); // (4,3)->(4,2)
    await o.press(Button.Up); // (4,2)->goal (4,1) '+'
    expect(cell(o, pad, 4, 1)).toBe("+");
    await o.press(Button.B);
    expect(cell(o, pad, 4, 1)).toBe(".");
    expect(cell(o, pad, 4, 2)).toBe("@");
    expect(movesOf(o)).toBe(1);
    o.unmount();
  });

  test("B reverses a non-goal push: the box is pulled back to the player's cell", async () => {
    const { o, pad } = await boot();
    // walk to (6,4) in 7 moves, then push the free box (5,4)->(4,4)
    for (const b of [
      Button.Up, Button.Up, Button.Down, Button.Down, Button.Right, Button.Right, Button.Down,
      Button.Left,
    ])
      await o.press(b);
    expect(cell(o, pad, 4, 4)).toBe("$");
    expect(cell(o, pad, 5, 4)).toBe("@");
    expect(movesOf(o)).toBe(8);
    await o.press(Button.B);
    expect(cell(o, pad, 5, 4)).toBe("$"); // box pulled back
    expect(cell(o, pad, 4, 4)).toBe(" "); // old box cell is plain floor
    expect(cell(o, pad, 6, 4)).toBe("@"); // player returned
    expect(movesOf(o)).toBe(7);
    o.unmount();
  });

  test("undoing a push that put a box ON a goal restores '*'->'.' and the '$' box; re-pushing re-enters", async () => {
    const { o, pad } = await boot();
    const SOLVE = "DLURRRDLULLDDRULURUULDRDDRRULDLUU";
    const KEY: Record<string, number> = { U: Button.Up, D: Button.Down, L: Button.Left, R: Button.Right };
    for (let i = 0; i < 22; i++) await o.press(KEY[SOLVE[i]]);
    // move 22 pushes a box down onto the goal at (3,3)
    expect(count(o, pad, "*")).toBe(1);
    expect(cell(o, pad, 3, 3)).toBe("*");
    await o.press(Button.B);
    expect(movesOf(o)).toBe(21);
    expect(cell(o, pad, 3, 3)).toBe("."); // goal restored to a dot
    expect(cell(o, pad, 3, 2)).toBe("$"); // box pulled back off the goal
    expect(count(o, pad, "*")).toBe(0);
    expect(count(o, pad, "$")).toBe(2);
    // repeat the undone push: the box goes back onto the goal
    await o.press(Button.Down);
    expect(cell(o, pad, 3, 3)).toBe("*");
    expect(count(o, pad, "*")).toBe(1);
    expect(movesOf(o)).toBe(22);
    o.unmount();
  });

  test("undo runs to the empty bottom and further B presses are no-ops", async () => {
    const { o, pad } = await boot();
    await o.press(Button.Up);
    await o.press(Button.Right);
    await o.press(Button.B);
    await o.press(Button.B); // empty
    expect(movesOf(o)).toBe(0);
    expect(cell(o, pad, 4, 3)).toBe("@");
    const before = board(o, pad).join("|");
    await o.press(Button.B);
    await o.press(Button.B);
    expect(board(o, pad).join("|")).toBe(before);
    expect(movesOf(o)).toBe(0);
    o.unmount();
  });

  test("a blocked press is not recorded, so undo skips it", async () => {
    const { o, pad } = await boot();
    await o.press(Button.Up); // 1
    await o.press(Button.Up); // 2 onto goal
    await o.press(Button.Up); // wall -> blocked, still 2
    await o.press(Button.B); // undoes the move onto the goal, not the bump
    expect(cell(o, pad, 4, 2)).toBe("@");
    expect(cell(o, pad, 4, 1)).toBe(".");
    expect(movesOf(o)).toBe(1);
    o.unmount();
  });

  test("a 64-move session is fully undoable on the oracle (stack >= 64)", async () => {
    const { o, pad } = await boot();
    // a clean open vertical oscillation by the goal: every press is a real
    // move, never blocked, so 64 presses record 64 history entries.
    for (let i = 0; i < 16; i++)
      for (const b of [Button.Up, Button.Up, Button.Down, Button.Down]) await o.press(b);
    expect(movesOf(o)).toBe(64);
    for (let i = 0; i < 64; i++) await o.press(Button.B);
    expect(movesOf(o)).toBe(0);
    expect(cell(o, pad, 4, 3)).toBe("@");
    const before = board(o, pad).join("|");
    await o.press(Button.B);
    await o.press(Button.B);
    expect(board(o, pad).join("|")).toBe(before);
    o.unmount();
  });
});

describe("sokoban restart and level select", () => {
  async function boot() {
    const g = GEOMS[0];
    const o = await bootFor(g);
    return { o, pad: g.pad };
  }

  test("Start restarts board, moves and history", async () => {
    const { o, pad } = await boot();
    await o.press(Button.Up);
    await o.press(Button.Left);
    await o.press(Button.B); // history now holds one move
    await o.press(Button.Start);
    expect(movesOf(o)).toBe(0);
    expect(board(o, pad).join("")).toBe(LEVEL_ROM.slice(0, BW * BH));
    const before = board(o, pad).join("|");
    await o.press(Button.B); // history was cleared: no-op
    expect(board(o, pad).join("|")).toBe(before);
    o.unmount();
  });

  test("Select opens the chooser on the current slot and play keys move only the cursor", async () => {
    const { o, pad } = await boot();
    await o.press(Button.Select);
    expect(modeOf(o)).toBe(1);
    expect(rowText(o, BANNER_Y)).toContain("LEVEL 01/24");
    const before = board(o, pad).join("|");
    for (const b of [Button.Up, Button.Down, Button.Left, Button.Right]) await o.press(b);
    expect(board(o, pad).join("|")).toBe(before); // board untouched
    expect(movesOf(o)).toBe(0);
    o.unmount();
  });

  test("chooser cursor steps with the d-pad and wraps 1<->24 both ways", async () => {
    const { o } = await boot();
    await o.press(Button.Select);
    await o.press(Button.Left); // 1 -> 24
    expect(rowText(o, BANNER_Y)).toContain("LEVEL 24/24");
    await o.press(Button.Right); // 24 -> 1
    expect(rowText(o, BANNER_Y)).toContain("LEVEL 01/24");
    await o.press(Button.Up); // Up steps -1 -> 24
    expect(rowText(o, BANNER_Y)).toContain("LEVEL 24/24");
    await o.press(Button.Down); // Down steps +1 -> 1
    expect(rowText(o, BANNER_Y)).toContain("LEVEL 01/24");
    o.unmount();
  });

  test("L and R shoulder buttons step the chooser cursor", async () => {
    const { o } = await boot();
    await o.press(Button.Select);
    await o.press(Button.R);
    expect(rowText(o, BANNER_Y)).toContain("LEVEL 02/24");
    await o.press(Button.L);
    expect(rowText(o, BANNER_Y)).toContain("LEVEL 01/24");
    o.unmount();
  });

  test("A confirms and loads slot 2 (#44), rebuilding the board from ROM", async () => {
    const { o, pad } = await boot();
    await o.press(Button.Select);
    await o.press(Button.Right);
    await o.press(Button.A);
    expect(modeOf(o)).toBe(0);
    expect(rowText(o, 0)).toContain("SOKOBAN 02/24");
    expect(movesOf(o)).toBe(0);
    expect(board(o, pad)[3]).toBe(LEVEL_ROM.slice(1 * STRIDE + 3 * BW, 1 * STRIDE + 4 * BW));
    expect(cell(o, pad, 3, 3)).toBe("@");
    o.unmount();
  });

  test("Start also confirms; B and Select cancel and keep the current level", async () => {
    const { o, pad } = await boot();
    await o.press(Button.Select);
    await o.press(Button.Right);
    await o.press(Button.B); // cancel with B
    expect(modeOf(o)).toBe(0);
    expect(rowText(o, 0)).toContain("SOKOBAN 01/24");
    expect(cell(o, pad, 4, 3)).toBe("@");

    await o.press(Button.Select);
    await o.press(Button.Right);
    await o.press(Button.Right);
    await o.press(Button.Select); // cancel with Select
    expect(modeOf(o)).toBe(0);
    expect(rowText(o, 0)).toContain("SOKOBAN 01/24");
    o.unmount();
  });

  test("Start confirms slot 1 from the chooser, which restarts the current level", async () => {
    const { o, pad } = await boot();
    await o.press(Button.Up);
    expect(movesOf(o)).toBe(1);
    await o.press(Button.Select); // cursor stays on 1
    await o.press(Button.Start); // confirm current slot == restart
    expect(movesOf(o)).toBe(0);
    expect(cell(o, pad, 4, 3)).toBe("@");
    o.unmount();
  });
});

describe("sokoban solved detection and advance", () => {
  const SOLVE1 = "DLURRRDLULLDDRULURUULDRDDRRULDLUU";
  const SOLVE24 = "UURRDDRDLUUULLDDRRDRRDDLLULURUUULLDDR";
  const KEY: Record<string, number> = { U: Button.Up, D: Button.Down, L: Button.Left, R: Button.Right };

  async function boot() {
    const g = GEOMS[0];
    const o = await bootFor(g);
    return { o, pad: g.pad };
  }
  const press = (o: Oracle, path: string) => (async () => {
    for (const ch of path) await o.press(KEY[ch]);
  })();

  test("the winning move shows SOLVED with the move count and two '*' boxes", async () => {
    const { o, pad } = await boot();
    await press(o, SOLVE1);
    expect(modeOf(o)).toBe(2);
    expect(rowText(o, 0)).toContain("SOLVED");
    expect(movesOf(o)).toBe(33);
    expect(count(o, pad, "$")).toBe(0);
    expect(count(o, pad, "*")).toBe(2);
    o.unmount();
  });

  test("while SOLVED every button but A is frozen", async () => {
    const { o, pad } = await boot();
    await press(o, SOLVE1);
    const before = board(o, pad).join("|");
    for (const b of [
      Button.Up, Button.Down, Button.Left, Button.Right, Button.B,
      Button.Start, Button.Select, Button.L, Button.R,
    ]) {
      await o.press(b);
      expect(modeOf(o)).toBe(2);
      expect(board(o, pad).join("|")).toBe(before);
      expect(movesOf(o)).toBe(33);
    }
    o.unmount();
  });

  test("A advances to slot 2 with a fresh board; one push solves it; A then loads slot 3", async () => {
    const { o, pad } = await boot();
    await press(o, SOLVE1);
    await o.press(Button.A);
    expect(modeOf(o)).toBe(0);
    expect(rowText(o, 0)).toContain("SOKOBAN 02/24");
    expect(movesOf(o)).toBe(0);
    expect(cell(o, pad, 3, 3)).toBe("@");
    await o.press(Button.Right); // the single tutorial push
    expect(modeOf(o)).toBe(2);
    expect(movesOf(o)).toBe(1);
    expect(count(o, pad, "*")).toBe(1);
    await o.press(Button.A);
    expect(modeOf(o)).toBe(0);
    expect(rowText(o, 0)).toContain("SOKOBAN 03/24");
    expect(movesOf(o)).toBe(0);
    expect(board(o, pad)[0]).toBe(LEVEL_ROM.slice(2 * STRIDE, 2 * STRIDE + BW));
    o.unmount();
  });

  test("after solving the LAST level, A returns to the chooser (no wrap to slot 1)", async () => {
    const { o } = await boot();
    await o.press(Button.Select);
    for (let i = 0; i < LEVEL_COUNT - 1; i++) await o.press(Button.Right);
    expect(rowText(o, BANNER_Y)).toContain("LEVEL 24/24");
    await o.press(Button.A);
    expect(rowText(o, 0)).toContain("SOKOBAN 24/24");
    await press(o, SOLVE24); // BFS solution of Microban #67
    expect(modeOf(o)).toBe(2);
    await o.press(Button.A);
    // back to a chooser aimed at slot 24, not a wrapped slot 1
    expect(modeOf(o)).toBe(1);
    expect(rowText(o, BANNER_Y)).toContain("LEVEL 24/24");
    await o.press(Button.B); // cancel stays on slot 24
    expect(modeOf(o)).toBe(0);
    expect(rowText(o, 0)).toContain("SOKOBAN 24/24");
    o.unmount();
  });
});

describe("sokoban 83-key tape vs the independent model", () => {
  test("moves / mode / slot after every press match the model", async () => {
    const g = GEOMS[0];
    const o = await bootFor(g);
    expect(SOKOBAN_TAPE.length).toBe(83);
    expect(SOKOBAN_MOVES_AFTER.length).toBe(83);
    expect(SOKOBAN_MODE_AFTER.length).toBe(83);
    expect(SOKOBAN_SLOT_AFTER.length).toBe(83);
    for (let i = 0; i < SOKOBAN_TAPE.length; i++) {
      await o.press(SOKOBAN_TAPE[i]);
      expect(movesOf(o)).toBe(SOKOBAN_MOVES_AFTER[i]);
      expect(modeOf(o)).toBe(SOKOBAN_MODE_AFTER[i]);
      if (SOKOBAN_MODE_AFTER[i] !== 2) {
        const two = String(SOKOBAN_SLOT_AFTER[i] + 1).padStart(2, "0");
        expect(rowText(o, 0)).toContain(`SOKOBAN ${two}/24`);
      }
    }
    o.unmount();
  });
});

describe("sokoban full-history policy: the 65th legal move is refused (review 1216)", () => {
  async function boot() {
    const g = GEOMS[0];
    const o = await bootFor(g);
    return { o, pad: g.pad };
  }
  const MOVES = 65;
  const PUSH_65 = 64; // tape index of the refused 65th move (0-based)

  test("63/64/65 are pushes; the cap holds moves at 64 and leaves the board at move-64 state", async () => {
    const { o, pad } = await boot();
    expect(SOKOBAN_HIST_BOUNDARY_TAPE.length).toBe(65 + 64 + 1);
    for (let i = 0; i < MOVES; i++) await o.press(SOKOBAN_HIST_BOUNDARY_TAPE[i]);
    // h63 and h64 were recorded pushes: box 1 driven from (3,3) down to (3,5)
    expect(cell(o, pad, 3, 5)).toBe("$");
    expect(cell(o, pad, 3, 4)).toBe("@"); // player after h64
    // h65 is a LEGAL push (Right into box 2 at (4,4)) but must be refused:
    // moves stay 64 and nothing on the board changes — most importantly the
    // player does NOT step to (4,4) and box 2 does NOT move to (5,4).
    expect(movesOf(o)).toBe(64);
    expect(modeOf(o)).toBe(0);
    expect(cell(o, pad, 3, 4)).toBe("@");
    expect(cell(o, pad, 4, 4)).toBe("$");
    expect(cell(o, pad, 5, 4)).toBe(" ");
    // the player gets feedback that the history is saturated
    expect(rowText(o, 10)).toMatch(/HIST(ORY)? FULL/);
    o.unmount();
  });

  test("64 undos replay every recorded inverse and restore the seeded board; extra B is a no-op", async () => {
    const { o, pad } = await boot();
    for (let i = 0; i < MOVES; i++) await o.press(SOKOBAN_HIST_BOUNDARY_TAPE[i]);
    for (let i = MOVES; i < MOVES + 64; i++) await o.press(SOKOBAN_HIST_BOUNDARY_TAPE[i]);
    expect(movesOf(o)).toBe(0);
    expect(cell(o, pad, 4, 3)).toBe("@");
    expect(cell(o, pad, 3, 3)).toBe("*"); // box 1 back on its goal
    expect(cell(o, pad, 5, 4)).toBe("$"); // box 2 back at its seed
    for (let y = 0; y < BH; y++) expect(board(o, pad)[y]).toBe(LEVEL_ROM.slice(y * BW, y * BW + BW));
    expect(rowText(o, 10)).not.toMatch(/HIST(ORY)? FULL/);
    const before = board(o, pad).join("|");
    await o.press(SOKOBAN_HIST_BOUNDARY_TAPE[MOVES + 64]); // the 65th, extra B
    expect(movesOf(o)).toBe(0);
    expect(board(o, pad).join("|")).toBe(before);
    o.unmount();
  });
});
