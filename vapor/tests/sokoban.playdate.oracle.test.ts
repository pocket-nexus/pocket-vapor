// vapor/tests/sokoban.playdate.oracle.test.ts — Pocket Sokoban's Playdate
// input variant under real Vue Vapor (50x30), plus its compile-time
// admission. The console file (sokoban.tsx) is covered by
// sokoban.oracle.test.ts and parity.test.ts; this file pins the Playdate
// control mapping from S2 §3.2:
//   MOVE:   d-pad move/push, B undo, A open chooser, crank 45-degree
//           detents scrub undo (anti-clockwise) / redo (clockwise);
//   SELECT: d-pad and crank move the cursor (24<->1 wrap), A confirms,
//           B cancels; restart is A then A on the current slot;
//   SOLVED: A advances; every button and the crank are frozen.
// The shared record shapes/geometry arrive through sokoban/shared.ts.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { compileVaporApp } from "../compiler/compile.ts";
import { Button, RelativeAxis, RelativeAxisUnits } from "../host/input.ts";
import { bootOracle, type Oracle } from "../oracle/boot.ts";
import { BH, BW, LEVEL_COUNT, LEVEL_ROM, STRIDE } from "../examples/sokoban/levels.ts";
import {
  BOARD_Y,
  BANNER_Y,
  HIST_CAP,
  PAD_20,
  PAD_22,
  PAD_30,
  PAD_50,
} from "../examples/sokoban/shared.ts";

const APP = join(import.meta.dir, "..", "examples", "sokoban", "sokoban.playdate.tsx");
const CONSOLE_APP = join(import.meta.dir, "..", "examples", "sokoban", "sokoban.tsx");
const ENTRY = join(import.meta.dir, "..", "oracle", "entry-sokoban-playdate.ts");
const PAD = 20; // the 50-wide screen centres the 10-wide board at x=20
const DETENT = 45 * RelativeAxisUnits.PerDegree;

const KEY: Record<string, number> = { U: Button.Up, D: Button.Down, L: Button.Left, R: Button.Right };
const SOLVE1 = "DLURRRDLULLDDRULURUULDRDDRRULDLUU";
const SOLVE24 = "UURRDDRDLUUULLDDRRDRRDDLLULURUUULLDDR";

async function boot(): Promise<Oracle> {
  const styles = compileVaporApp(APP, await Bun.file(APP).text(), "SOKOBAN", "playdate").styles;
  return bootOracle({ width: 50, height: 30, styles, entry: ENTRY });
}
function board(o: Oracle): string[] {
  return o.grid().chars.slice(BOARD_Y, BOARD_Y + BH).map((r) => r.slice(PAD, PAD + BW));
}
function cell(o: Oracle, x: number, y: number): string {
  return o.grid().chars[BOARD_Y + y][PAD + x];
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
async function pressPath(o: Oracle, path: string): Promise<void> {
  for (const ch of path) await o.press(KEY[ch]);
}

describe("sokoban playdate: shared module", () => {
  test("exports the same geometry both entries render with", () => {
    expect(BOARD_Y).toBe(2);
    expect(BANNER_Y).toBe(11);
    expect(HIST_CAP).toBe(64);
    expect(PAD_50.length).toBe(20);
    expect(PAD_30.length).toBe(10);
    expect(PAD_22.length).toBe(6);
    expect(PAD_20.length).toBe(5);
  });
});

describe("sokoban playdate: compile-time admission", () => {
  test("admits only A/B/d-pad plus the Primary crank axis for playdate", async () => {
    const source = await Bun.file(APP).text();
    const app = compileVaporApp(APP, source, "SOKOBAN", "playdate");
    expect(app.buttonsUsed).toEqual([0, 1, 4, 5, 6, 7]);
    expect(app.relativeAxesUsed).toEqual([RelativeAxis.Primary]);
    expect(app.c).toContain("static void vp_axis_handler_0(s32 axis_delta_arg)");
    expect(app.c).toContain("/ 45000");
    expect(app.c).toContain("% 45000");
    // no Start/Select/L/R survives into the Playdate C
    expect(app.c).not.toMatch(/VT101/);
  });

  test("console targets still reject the crank with VT102 and playdate no longer VT101s", async () => {
    const source = await Bun.file(APP).text();
    for (const target of ["gba", "gb", "nes", "esp32"] as const) {
      expect(() => compileVaporApp(APP, source, "SOKOBAN", target)).toThrow(
        new RegExp(`VT102: ${target} has no adapter for relative axis Primary`),
      );
    }
    // the console-only file keeps failing playdate with VT101 (variant needed)
    const consoleSrc = await Bun.file(CONSOLE_APP).text();
    expect(() => compileVaporApp(CONSOLE_APP, consoleSrc, "SOKOBAN", "playdate")).toThrow(
      /VT101: playdate has no physical input for Select, Start, R, L/,
    );
  });

  test("both entries import the shared data modules instead of inlining them", async () => {
    const variant = await Bun.file(APP).text();
    const console = await Bun.file(CONSOLE_APP).text();
    for (const src of [variant, console]) {
      expect(src).toContain(`from "./levels.ts"`);
      expect(src).toMatch(/from "\.\/shared\.ts"/);
      expect(src).toContain("HIST_CAP");
    }
  });
});

describe("sokoban playdate: boot layout on 50x30", () => {
  test("title, Microban credit, crank help and the slot-1 board", async () => {
    const o = await boot();
    expect(rowText(o, 0)).toContain("SOKOBAN 01/24");
    expect(rowText(o, 0)).toContain("MOVES 0");
    expect(rowText(o, 28)).toContain("SKINNER");
    expect(rowText(o, 29)).toContain("CRANK");
    expect(rowText(o, 29)).toContain("UNDO/REDO");
    for (let y = 0; y < BH; y++) expect(board(o)[y]).toBe(LEVEL_ROM.slice(y * BW, y * BW + BW));
    o.unmount();
  });
});

describe("sokoban playdate: d-pad movement, push and B undo", () => {
  test("walk and push behave like the console build; B undoes", async () => {
    const o = await boot();
    await o.press(Button.Up);
    await o.press(Button.Up); // onto goal (4,1)
    expect(cell(o, 4, 1)).toBe("+");
    expect(movesOf(o)).toBe(2);
    await o.press(Button.B);
    expect(cell(o, 4, 1)).toBe(".");
    expect(cell(o, 4, 2)).toBe("@");
    expect(movesOf(o)).toBe(1);
    o.unmount();
  });

  test("a wall bump is a silent no-op", async () => {
    const o = await boot();
    await o.press(Button.Left); // (4,3) -> (3,3) is box; box blocked by wall
    expect(movesOf(o)).toBe(0);
    expect(cell(o, 4, 3)).toBe("@");
    o.unmount();
  });
});

describe("sokoban playdate: crank undo/redo scrub", () => {
  test("sub-45-degree motion accumulates; the completing millidegree undoes one", async () => {
    const o = await boot();
    await o.press(Button.Up);
    await o.press(Button.Up); // moves = 2, player on the goal
    await o.axisDelta(RelativeAxis.Primary, -(DETENT - 1)); // just under one undo
    expect(movesOf(o)).toBe(2);
    expect(cell(o, 4, 1)).toBe("+");
    await o.axisDelta(RelativeAxis.Primary, -1); // remainder completes the detent
    expect(movesOf(o)).toBe(1);
    expect(cell(o, 4, 1)).toBe(".");
    expect(cell(o, 4, 2)).toBe("@");
    o.unmount();
  });

  test("clockwise detents redo, including two steps in one delta; extra redo is a no-op", async () => {
    const o = await boot();
    await o.press(Button.Up);
    await o.press(Button.Up);
    await o.axisDelta(RelativeAxis.Primary, -DETENT);
    await o.axisDelta(RelativeAxis.Primary, -DETENT); // both undone
    expect(movesOf(o)).toBe(0);
    expect(cell(o, 4, 3)).toBe("@");
    await o.axisDelta(RelativeAxis.Primary, 2 * DETENT); // replay both at once
    expect(movesOf(o)).toBe(2);
    expect(cell(o, 4, 1)).toBe("+");
    await o.axisDelta(RelativeAxis.Primary, DETENT); // nothing left to redo
    expect(movesOf(o)).toBe(2);
    o.unmount();
  });

  test("an effective d-pad move clears the redo stack", async () => {
    const o = await boot();
    await o.press(Button.Up); // (4,3)->(4,2)
    await o.axisDelta(RelativeAxis.Primary, -DETENT); // back to (4,3), one redo queued
    expect(movesOf(o)).toBe(0);
    await o.press(Button.Right); // fresh move (4,3)->(5,3); redo invalidated
    expect(movesOf(o)).toBe(1);
    await o.axisDelta(RelativeAxis.Primary, DETENT); // redo stack empty: no-op
    expect(movesOf(o)).toBe(1);
    expect(cell(o, 5, 3)).toBe("@");
    await o.axisDelta(RelativeAxis.Primary, -DETENT); // undo the Right
    expect(movesOf(o)).toBe(0);
    expect(cell(o, 4, 3)).toBe("@");
    o.unmount();
  });

  test("crank undo of a pushed box pulls it back and restores goal glyphs", async () => {
    const o = await boot();
    for (const b of [
      Button.Up, Button.Up, Button.Down, Button.Down, Button.Right, Button.Right, Button.Down,
      Button.Left,
    ])
      await o.press(b); // 8 moves, box pushed to (4,4)
    expect(cell(o, 4, 4)).toBe("$");
    await o.axisDelta(RelativeAxis.Primary, -DETENT);
    expect(cell(o, 5, 4)).toBe("$"); // box pulled back by the crank undo
    expect(cell(o, 4, 4)).toBe(" ");
    expect(cell(o, 6, 4)).toBe("@");
    expect(movesOf(o)).toBe(7);
    await o.axisDelta(RelativeAxis.Primary, DETENT); // crank redo re-pushes
    expect(cell(o, 4, 4)).toBe("$");
    expect(cell(o, 5, 4)).toBe("@");
    expect(movesOf(o)).toBe(8);
    o.unmount();
  });
});

describe("sokoban playdate: chooser without Start/Select", () => {
  test("A opens the chooser on the current slot; d-pad wraps 1<->24", async () => {
    const o = await boot();
    await o.press(Button.A);
    expect(modeOf(o)).toBe(1);
    expect(rowText(o, BANNER_Y)).toContain("LEVEL 01/24");
    await o.press(Button.Left); // 1 -> 24
    expect(rowText(o, BANNER_Y)).toContain("LEVEL 24/24");
    await o.press(Button.Right); // 24 -> 1
    expect(rowText(o, BANNER_Y)).toContain("LEVEL 01/24");
    o.unmount();
  });

  test("crank detents step the cursor and wrap both ways", async () => {
    const o = await boot();
    await o.press(Button.A);
    await o.axisDelta(RelativeAxis.Primary, DETENT);
    expect(rowText(o, BANNER_Y)).toContain("LEVEL 02/24");
    await o.axisDelta(RelativeAxis.Primary, -2 * DETENT); // 2 -> 1 -> 24
    expect(rowText(o, BANNER_Y)).toContain("LEVEL 24/24");
    o.unmount();
  });

  test("B cancels and keeps the current level", async () => {
    const o = await boot();
    await o.press(Button.A);
    await o.press(Button.Right);
    await o.press(Button.Right);
    await o.press(Button.B);
    expect(modeOf(o)).toBe(0);
    expect(rowText(o, 0)).toContain("SOKOBAN 01/24");
    expect(cell(o, 4, 3)).toBe("@");
    o.unmount();
  });

  test("A confirms another slot and rebuilds it; chooser d-pad never moves the board", async () => {
    const o = await boot();
    await o.press(Button.A);
    await o.press(Button.Right);
    await o.press(Button.A);
    expect(modeOf(o)).toBe(0);
    expect(rowText(o, 0)).toContain("SOKOBAN 02/24");
    expect(movesOf(o)).toBe(0);
    expect(cell(o, 3, 3)).toBe("@");
    expect(board(o)[3]).toBe(LEVEL_ROM.slice(1 * STRIDE + 3 * BW, 1 * STRIDE + 4 * BW));
    o.unmount();
  });

  test("restart is two A presses: open on the current slot, confirm it", async () => {
    const o = await boot();
    await o.press(Button.Up);
    await o.press(Button.Up); // (4,3)->(4,2)->goal (4,1); moves = 2
    expect(movesOf(o)).toBe(2);
    await o.press(Button.A); // chooser, cursor parked on slot 1
    expect(rowText(o, BANNER_Y)).toContain("LEVEL 01/24");
    await o.press(Button.A); // confirm the current slot == restart
    expect(modeOf(o)).toBe(0);
    expect(movesOf(o)).toBe(0);
    expect(cell(o, 4, 3)).toBe("@");
    for (let y = 0; y < BH; y++)
      expect(board(o)[y]).toBe(LEVEL_ROM.slice(y * BW, y * BW + BW));
    // crank history was rebuilt empty too: anti-clockwise is a no-op
    const before = board(o).join("|");
    await o.axisDelta(RelativeAxis.Primary, -DETENT);
    expect(board(o).join("|")).toBe(before);
    expect(movesOf(o)).toBe(0);
    o.unmount();
  });
});

describe("sokoban playdate: solved", () => {
  test("solving shows SOLVED; the crank and every d-pad/B press are frozen; A advances", async () => {
    const o = await boot();
    await pressPath(o, SOLVE1);
    expect(modeOf(o)).toBe(2);
    expect(movesOf(o)).toBe(33);
    const before = board(o).join("|");
    for (const delta of [-DETENT, DETENT, 3 * DETENT, -2 * DETENT])
      await o.axisDelta(RelativeAxis.Primary, delta);
    for (const b of [Button.Up, Button.Down, Button.Left, Button.Right, Button.B]) {
      await o.press(b);
      expect(modeOf(o)).toBe(2);
    }
    expect(board(o).join("|")).toBe(before);
    expect(movesOf(o)).toBe(33);
    await o.press(Button.A); // next level
    expect(modeOf(o)).toBe(0);
    expect(rowText(o, 0)).toContain("SOKOBAN 02/24");
    expect(movesOf(o)).toBe(0);
    o.unmount();
  });

  test("one push solves slot 2, A advances to slot 3", async () => {
    const o = await boot();
    await pressPath(o, SOLVE1);
    await o.press(Button.A);
    await o.press(Button.Right);
    expect(modeOf(o)).toBe(2);
    expect(movesOf(o)).toBe(1);
    await o.press(Button.A);
    expect(rowText(o, 0)).toContain("SOKOBAN 03/24");
    o.unmount();
  });

  test("after solving the last level A returns to the chooser aimed at slot 24", async () => {
    const o = await boot();
    await o.press(Button.A);
    for (let i = 0; i < LEVEL_COUNT - 1; i++) await o.press(Button.Right);
    expect(rowText(o, BANNER_Y)).toContain("LEVEL 24/24");
    await o.press(Button.A);
    expect(rowText(o, 0)).toContain("SOKOBAN 24/24");
    await pressPath(o, SOLVE24);
    expect(modeOf(o)).toBe(2);
    await o.press(Button.A);
    expect(modeOf(o)).toBe(1);
    expect(rowText(o, BANNER_Y)).toContain("LEVEL 24/24");
    await o.press(Button.B);
    expect(modeOf(o)).toBe(0);
    expect(rowText(o, 0)).toContain("SOKOBAN 24/24");
    o.unmount();
  });
});
