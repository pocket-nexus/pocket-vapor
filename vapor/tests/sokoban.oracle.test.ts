// vapor/tests/sokoban.oracle.test.ts — Pocket Sokoban (slice P2①) under real
// Vue Vapor. Every movement rule shipped in this slice has a case:
// board/title/credit rendering on all three console geometries, walking,
// the goal glyphs '+'/'.', box pushing ('$' -> '*' on a goal), and the
// three blocks (push into wall, bump a wall, push into a stopped box).
//
// The three-console cell-for-cell replay lives in parity.test.ts.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { compileVaporApp, type VaporTargetName } from "../compiler/compile.ts";
import { Button } from "../host/input.ts";
import { bootOracle, type Oracle } from "../oracle/boot.ts";
import { BW, BH, STRIDE, LEVEL_ROM } from "../examples/sokoban/levels.ts";
import { SOKOBAN_TAPE, SOKOBAN_MOVES_AFTER } from "./sokoban-tape.ts";

const APP = join(import.meta.dir, "..", "examples", "sokoban", "sokoban.tsx");
const ENTRY = join(import.meta.dir, "..", "oracle", "entry-sokoban.ts");
const BOARD_Y = 2;

// geometry -> screen size, board origin x, style target
const GEOMS = [
  { name: "gba", w: 30, h: 20, pad: 10, target: "gba" as VaporTargetName },
  { name: "gb", w: 20, h: 18, pad: 5, target: "gb" as VaporTargetName },
  { name: "nes", w: 22, h: 18, pad: 6, target: "nes" as VaporTargetName },
];

async function bootFor(g: (typeof GEOMS)[number]): Promise<Oracle> {
  const styles = compileVaporApp(APP, await Bun.file(APP).text(), "SOKOBAN", g.target).styles;
  return bootOracle({ width: g.w, height: g.h, styles, entry: ENTRY });
}

/** The 8x10 board block, cut out of the painted screen. */
function board(o: Oracle, pad: number): string[] {
  return o.grid().chars.slice(BOARD_Y, BOARD_Y + BH).map((r) => r.slice(pad, pad + BW));
}
/** One cell of the painted block. */
function cell(o: Oracle, pad: number, x: number, y: number): string {
  return o.grid().chars[BOARD_Y + y][pad + x];
}
function movesOf(o: Oracle): number {
  const m = o.grid().chars[0].match(/\bM(?:OVES )?(\d+)/);
  return Number(m![1]);
}

describe("sokoban boot and layout (three geometries)", () => {
  for (const g of GEOMS) {
    test(`${g.name}: title, credit, help and board match LEVEL_ROM slot 1`, async () => {
      const o = await bootFor(g);
      const screen = o.grid().chars;

      // title line: level number + zero move count
      expect(screen[0]).toContain("SOKOBAN 01/24");
      expect(screen[0]).toMatch(g.w >= 30 ? /MOVES 0/ : /M0(?!\d)/);
      // the required David W. Skinner attribution stays on screen
      expect(screen[g.h - 2]).toContain("SKINNER");
      // help line mentions movement
      expect(screen[g.h - 1]).toContain("MOVE");

      // the 8 board rows are slot 0 of the ROM table, painted at the
      // per-screen origin (GBA 10, GB 5, NES 6)
      const got = board(o, g.pad);
      for (let y = 0; y < BH; y++) expect(got[y]).toBe(LEVEL_ROM.slice(y * BW, y * BW + BW));

      o.unmount();
    });

    test(`${g.name}: the space outside the board/chrome rows is blank`, async () => {
      const o = await bootFor(g);
      const screen = o.grid().chars;
      for (let y = 1; y < g.h; y++) {
        if (y === g.h - 1 || y === g.h - 2) continue; // chrome
        if (y >= BOARD_Y && y < BOARD_Y + BH) continue;
        for (let x = 0; x < g.w; x++) expect(screen[y][x]).toBe(" ");
      }
      o.unmount();
    });
  }
});

describe("sokoban movement rules", () => {
  // Rule cases run on the 30x20 oracle; the parity suite replays the same
  // tape cell-for-cell on GB and NES.
  async function boot(): Promise<{ o: Oracle; pad: number }> {
    const g = GEOMS[0];
    return { o: await bootFor(g), pad: g.pad };
  }

  test("walking moves the player, restores plain floor, counts one move", async () => {
    const { o, pad } = await boot();
    await o.press(Button.Up); // (4,3) -> (4,2)
    expect(cell(o, pad, 4, 3)).toBe(" "); // plain floor behind
    expect(cell(o, pad, 4, 2)).toBe("@");
    expect(movesOf(o)).toBe(1);
    o.unmount();
  });

  test("walking onto a goal paints '+' and leaving restores the goal '.'", async () => {
    const { o, pad } = await boot();
    expect(LEVEL_ROM[0 * STRIDE + 1 * BW + 4]).toBe("."); // terrain at (4,1)
    await o.press(Button.Up);
    await o.press(Button.Up); // (4,2) -> goal (4,1)
    expect(cell(o, pad, 4, 1)).toBe("+");
    await o.press(Button.Down); // back to (4,2)
    expect(cell(o, pad, 4, 1)).toBe(".");
    expect(movesOf(o)).toBe(3);
    o.unmount();
  });

  test("a pushed box advances and the player steps into its old cell", async () => {
    const { o, pad } = await boot();
    // walk to (6,4): Up,Up,Down,Down,Right,Right,Down -> 7 moves
    for (const b of [Button.Up, Button.Up, Button.Down, Button.Down, Button.Right, Button.Right, Button.Down])
      await o.press(b);
    expect(cell(o, pad, 5, 4)).toBe("$"); // box directly left of player
    await o.press(Button.Left); // push box (5,4) -> (4,4)
    expect(cell(o, pad, 4, 4)).toBe("$");
    expect(cell(o, pad, 5, 4)).toBe("@");
    expect(movesOf(o)).toBe(8);
    o.unmount();
  });

  test("a box pushed onto a goal becomes '*', and the full solve leaves two '*' and no '$'", async () => {
    const { o, pad } = await boot();
    const key: Record<string, number> = { U: Button.Up, D: Button.Down, L: Button.Left, R: Button.Right };
    // 33-move BFS-optimal solve of Microban #1 (P2 scout).
    const solve = "DLURRRDLULLDDRULURUULDRDDRRULDLUU";
    // The winning push lands the second box on the goal (3,1).
    const before = solve.slice(0, solve.length - 1);
    for (const ch of before) await o.press(key[ch]);
    // before the last press one box is still '$'
    expect((board(o, pad).join("").match(/\$/g) ?? []).length).toBe(1);
    await o.press(key[solve[solve.length - 1]]);
    const all = board(o, pad).join("");
    expect((all.match(/\$/g) ?? []).length).toBe(0);
    expect((all.match(/\*/g) ?? []).length).toBe(2);
    expect(movesOf(o)).toBe(33);
    o.unmount();
  });

  test("the first tape press cannot push a box-on-goal through the wall", async () => {
    const { o, pad } = await boot();
    await o.press(Button.Left); // '*' at (3,3), wall '#' beyond at (2,3)
    expect(cell(o, pad, 3, 3)).toBe("*"); // box unmoved
    expect(cell(o, pad, 4, 3)).toBe("@"); // player unmoved
    expect(movesOf(o)).toBe(0);
    o.unmount();
  });

  test("bumping a wall with no box does not move or count", async () => {
    const { o, pad } = await boot();
    await o.press(Button.Up);
    await o.press(Button.Up); // now on goal (4,1)
    await o.press(Button.Up); // wall at (4,0)
    expect(cell(o, pad, 4, 1)).toBe("+");
    expect(movesOf(o)).toBe(2);
    o.unmount();
  });

  test("pushing a box into a stopped box (box behind box) is blocked", async () => {
    const { o, pad } = await boot();
    // 13 setup presses leave the player at (3,5), the pushed box '$' at
    // (3,4) and the box-on-goal '*' at (3,3).
    for (const b of SOKOBAN_TAPE.slice(0, 13)) await o.press(b);
    expect(cell(o, pad, 3, 5)).toBe("@");
    expect(cell(o, pad, 3, 4)).toBe("$");
    expect(cell(o, pad, 3, 3)).toBe("*");
    await o.press(Button.Up); // would push '$' into '*' -> blocked
    expect(cell(o, pad, 3, 4)).toBe("$");
    expect(cell(o, pad, 3, 5)).toBe("@");
    expect(movesOf(o)).toBe(SOKOBAN_MOVES_AFTER[13]); // 11, unchanged
    o.unmount();
  });

  test("the whole 14-press tape matches the scout move-count model", async () => {
    const { o } = await boot();
    for (let i = 0; i < SOKOBAN_TAPE.length; i++) {
      await o.press(SOKOBAN_TAPE[i]);
      expect(movesOf(o)).toBe(SOKOBAN_MOVES_AFTER[i]);
    }
    o.unmount();
  });

  test("buttons not bound in this slice (A/B/Start/Select/L/R) are no-ops", async () => {
    const { o, pad } = await boot();
    const before = board(o, pad).join("|");
    for (const b of [Button.A, Button.B, Button.Start, Button.Select, Button.L, Button.R]) {
      await o.press(b);
      expect(board(o, pad).join("|")).toBe(before);
    }
    expect(movesOf(o)).toBe(0);
    o.unmount();
  });
});
