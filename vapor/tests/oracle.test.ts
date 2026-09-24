// vapor/test/oracle.test.ts — VAPOR TODO under real Vue Vapor (the oracle).
//
// These tests pin the app's semantics on the reference implementation:
// vue 3.6 runtime-with-vapor over the micro-DOM, painted to the 30x20 grid.
// The ROM parity suite replays the same button tapes against the compiled
// .gba and compares grids cell-for-cell.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { compileVaporApp } from "../compiler/compile.ts";
import { Button } from "../host/input.ts";
import { bootOracle, type Oracle } from "../oracle/boot.ts";

const ENTRY = join(import.meta.dir, "..", "examples", "todo", "todo.tsx");
const styles = compileVaporApp(ENTRY, await Bun.file(ENTRY).text(), "VAPOR TODO", "gba").styles;
const boot = () => bootOracle({ styles });

function line(oracle: Awaited<ReturnType<typeof bootOracle>>, y: number): string {
  return oracle.grid().chars[y];
}

// The pooled-string-row test board mounts through its own bundle entry; its
// read (ln.text[i]) and in-place write (putChar) must behave under real Vue
// exactly the way the compiled device behaves.
const BOARD_ENTRY = join(import.meta.dir, "fixtures", "board-entry.ts");
const BOARD_SRC = join(import.meta.dir, "fixtures", "board.tsx");
const boardStyles = compileVaporApp(BOARD_SRC, await Bun.file(BOARD_SRC).text(), "BOARD", "gba").styles;
const bootBoard = () => bootOracle({ width: 30, height: 20, styles: boardStyles, entry: BOARD_ENTRY });
const brow = (o: Oracle, y: number): string => o.grid().chars[y].slice(0, 7);

describe("vapor todo oracle", () => {
  test("boots with seed todos and computed header", async () => {
    const o = await boot();
    expect(line(o, 0)).toBe(("      POCKET VAPOR TODO").padEnd(30)); // align-center
    expect(line(o, 1)).toBe(" 2 LEFT / ALL".padEnd(30));
    expect(line(o, 3)).toBe(" >[ ] SHIP POCKET VAPOR".padEnd(30));
    expect(line(o, 4)).toBe("  [X] WRITE THE COMPILER".padEnd(30));
    expect(line(o, 5)).toBe("  [ ] RUN ON DEVICE".padEnd(30));
    expect(line(o, 19)).toBe(" A:DONE B:DEL R:FILT ST:NEW".padEnd(30));
    o.unmount();
  });

  test("cursor moves and toggle updates remaining", async () => {
    const o = await boot();
    await o.press(Button.Down);
    expect(line(o, 3)).toBe("  [ ] SHIP POCKET VAPOR".padEnd(30));
    expect(line(o, 4)).toBe(" >[X] WRITE THE COMPILER".padEnd(30));
    await o.press(Button.A); // un-done the second todo
    expect(line(o, 1)).toBe(" 3 LEFT / ALL".padEnd(30));
    expect(line(o, 4)).toBe(" >[ ] WRITE THE COMPILER".padEnd(30));
    o.unmount();
  });

  test("filters are a computed view", async () => {
    const o = await boot();
    await o.press(Button.R); // ACTIVE
    expect(line(o, 1)).toBe(" 2 LEFT / ACTIVE".padEnd(30));
    expect(line(o, 3)).toBe(" >[ ] SHIP POCKET VAPOR".padEnd(30));
    expect(line(o, 4)).toBe("  [ ] RUN ON DEVICE".padEnd(30));
    expect(line(o, 5)).toBe("".padEnd(30));
    await o.press(Button.R); // DONE
    expect(line(o, 1)).toBe(" 2 LEFT / DONE".padEnd(30));
    expect(line(o, 3)).toBe(" >[X] WRITE THE COMPILER".padEnd(30));
    await o.press(Button.R); // back to ALL
    expect(line(o, 1)).toBe(" 2 LEFT / ALL".padEnd(30));
    o.unmount();
  });

  test("delete, clear completed, and the empty state", async () => {
    const o = await boot();
    await o.press(Button.B); // delete first
    expect(line(o, 3)).toBe(" >[X] WRITE THE COMPILER".padEnd(30));
    await o.press(Button.Select); // clear completed
    expect(line(o, 3)).toBe(" >[ ] RUN ON DEVICE".padEnd(30));
    expect(line(o, 1)).toBe(" 1 LEFT / ALL".padEnd(30));
    await o.press(Button.B);
    expect(line(o, 3)).toBe(" NOTHING HERE".padEnd(30));
    o.unmount();
  });

  test("edit mode composes a todo through the glyph picker", async () => {
    const o = await boot();
    await o.press(Button.Start);
    expect(line(o, 17)).toBe(" NEW: [A]".padEnd(30));
    expect(line(o, 19)).toBe(" A:PUT B:DEL ST:SAVE SE:QUIT".padEnd(30));
    await o.press(Button.A); // put A
    await o.press(Button.Right); // glyph B
    await o.press(Button.A); // put B
    expect(line(o, 17)).toBe(" NEW: AB[B]".padEnd(30));
    await o.press(Button.B); // backspace
    expect(line(o, 17)).toBe(" NEW: A[B]".padEnd(30));
    await o.press(Button.Start); // save
    expect(line(o, 17)).toBe("".padEnd(30));
    expect(line(o, 6)).toBe("  [ ] A".padEnd(30));
    expect(line(o, 1)).toBe(" 3 LEFT / ALL".padEnd(30));
    o.unmount();
  });

  test("glyph picker wraps left from A to 9", async () => {
    const o = await boot();
    await o.press(Button.Start);
    await o.press(Button.Left);
    expect(line(o, 17)).toBe(" NEW: [9]".padEnd(30));
    await o.press(Button.Select); // cancel
    expect(line(o, 17)).toBe("".padEnd(30));
    o.unmount();
  });

  test("cursor clamps when the view shrinks", async () => {
    const o = await boot();
    await o.press(Button.Down);
    await o.press(Button.Down); // cursor on last
    await o.press(Button.B); // delete last -> cursor clamps to new last
    expect(line(o, 4)).toBe(" >[X] WRITE THE COMPILER".padEnd(30));
    o.unmount();
  });
});

// putChar is amphibious: this is the reference semantics the compiler's
// vp_sb_put must reproduce cell-for-cell on device (see board parity test).
describe("pooled string-row board oracle (vp_sb_at + putChar)", () => {
  test("dynamic read reflects the byte, in-place write toggles a cell", async () => {
    const o = await bootBoard();
    expect(brow(o, 0)).toBe(".......");
    expect(o.grid().chars[3].trim()).toBe("0,0");

    await o.press(Button.A); // toggle (0,0) . -> $
    expect(brow(o, 0)).toBe("$......");

    await o.press(Button.Right);
    await o.press(Button.A); // toggle (1,0) -> $
    expect(brow(o, 0)).toBe("$$.....");
    expect(o.grid().chars[3].trim()).toBe("1,0");

    await o.press(Button.A); // toggle (1,0) back to .
    expect(brow(o, 0)).toBe("$......");

    await o.press(Button.Down);
    await o.press(Button.Left);
    await o.press(Button.A); // toggle (0,1) -> $
    expect(brow(o, 0)).toBe("$......");
    expect(brow(o, 1)).toBe("$......");
    expect(o.grid().chars[3].trim()).toBe("0,1");
    o.unmount();
  });

  test("a write past the string end is a no-op", async () => {
    const o = await bootBoard();
    await o.press(Button.A); // (0,0) -> $
    await o.press(Button.Select); // badWrite index 9 >= 7
    expect(brow(o, 0)).toBe("$......");
    expect(brow(o, 1)).toBe(".......");
    expect(brow(o, 2)).toBe(".......");
    o.unmount();
  });
});

// withCapacity is the identity under real Vue: the declared capacity is a
// device-only static allocation, never a bound on the JS array. So the 64
// here must NOT cap oracle growth — the same source grows unbounded in JS
// while the compiled device trips POOL_FULL on push 65. That two-life split
// is the contract of host/list.ts.
const CAP_ENTRY = join(import.meta.dir, "fixtures", "capacity-entry.ts");
const CAP_SRC_PATH = join(import.meta.dir, "fixtures", "capacity.tsx");
const capStyles = compileVaporApp(
  CAP_SRC_PATH,
  await Bun.file(CAP_SRC_PATH).text(),
  "CAP",
  "nes",
).styles;
const bootCap = () => bootOracle({ width: 22, height: 18, styles: capStyles, entry: CAP_ENTRY });

describe("per-pool capacity oracle (withCapacity is identity)", () => {
  test("12 seeded string rows render and the undo stack pushes/pops", async () => {
    const o = await bootCap();
    for (let y = 0; y < 12; y++) expect(o.grid().chars[y]).toBe("..........".padEnd(22));
    expect(o.grid().chars[13].trim()).toBe("0");

    await o.press(Button.A);
    await o.press(Button.A);
    expect(o.grid().chars[13].trim()).toBe("2");

    await o.press(Button.B); // splice newest
    expect(o.grid().chars[13].trim()).toBe("1");
    o.unmount();
  });

  test("the declared 64 does not bound the oracle array past 64", async () => {
    const o = await bootCap();
    for (let i = 0; i < 70; i++) await o.press(Button.A);
    // JS keeps growing; the device counterpart trips VP_TRIP_POOL_FULL at 65
    expect(o.grid().chars[13].trim()).toBe("70");
    await o.press(Button.B);
    expect(o.grid().chars[13].trim()).toBe("69");
    o.unmount();
  });
});
