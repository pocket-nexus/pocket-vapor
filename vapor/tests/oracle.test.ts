// vapor/test/oracle.test.ts — VAPOR TODO under real Vue Vapor (the oracle).
//
// These tests pin the app's semantics on the reference implementation:
// vue 3.6 runtime-with-vapor over the micro-DOM, painted to the 30x20 grid.
// The ROM parity suite replays the same button tapes against the compiled
// .gba and compares grids cell-for-cell.

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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

// D207: the char-vs-one-char-literal board must behave the same under real
// Vue Vapor — `"#" === "#"` there, a C char compare on device.
const CHARBOARD_ENTRY = join(import.meta.dir, "fixtures", "charboard-entry.ts");
const CHARBOARD_SRC = join(import.meta.dir, "fixtures", "charboard.tsx");
const charboardStyles = compileVaporApp(
  CHARBOARD_SRC,
  await Bun.file(CHARBOARD_SRC).text(),
  "CHARBOARD",
  "gba",
).styles;
const bootCharboard = () =>
  bootOracle({ width: 30, height: 20, styles: charboardStyles, entry: CHARBOARD_ENTRY });
const crow = (o: Oracle, y: number): string => o.grid().chars[y].slice(0, 4);

describe("char vs one-char literal oracle (D207)", () => {
  test("walls block moves and only floor cells mark", async () => {
    const o = await bootCharboard();
    expect(crow(o, 0)).toBe("#..#");
    expect(crow(o, 1)).toBe("1".padEnd(4));
    expect(crow(o, 2)).toBe("0".padEnd(4));

    await o.press(Button.Left); // blocked by the wall at 0
    expect(crow(o, 1)).toBe("1".padEnd(4));
    await o.press(Button.Right); // to 2
    expect(crow(o, 1)).toBe("2".padEnd(4));
    await o.press(Button.Right); // blocked by the wall at 3
    expect(crow(o, 1)).toBe("2".padEnd(4));
    await o.press(Button.A); // 2 is floor: mark
    expect(crow(o, 2)).toBe("1".padEnd(4));
    await o.press(Button.Left); // back to 1
    await o.press(Button.A);
    expect(crow(o, 2)).toBe("2".padEnd(4));
    await o.press(Button.Left); // blocked
    await o.press(Button.A); // 1 still floor: marks again
    expect(crow(o, 1)).toBe("1".padEnd(4));
    expect(crow(o, 2)).toBe("3".padEnd(4));
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

// Number-returning pure helpers are ordinary TypeScript: under the real Vue
// Vapor runtime they are just setup-scope closures. This pins the semantics
// the AOT extension (compile.ts fn result type) must match cell-for-cell.
const PURE_HELPER_FIXTURE = join(import.meta.dir, "fixtures", "pure-helper.tsx");
const pureHelperStyles = compileVaporApp(
  PURE_HELPER_FIXTURE,
  await Bun.file(PURE_HELPER_FIXTURE).text(),
  "PURE HELPER",
  "gba",
).styles;
const bootPureHelper = () =>
  bootOracle({
    styles: pureHelperStyles,
    entry: join(import.meta.dir, "..", "oracle", "entry-pure-helper.ts"),
  });

describe("pure number helper fixture under real Vue Vapor", () => {
  const row0 = (o: Awaited<ReturnType<typeof bootPureHelper>>) => o.grid().chars[0];
  const row1 = (o: Awaited<ReturnType<typeof bootPureHelper>>) => o.grid().chars[1];

  test("helper reads render: score sums codeAt over the pool", async () => {
    const o = await bootPureHelper();
    expect(row0(o)).toBe("S 6".padEnd(30)); // 1+2+3
    expect(row1(o)).toBe("I 0 V 1 T 6".padEnd(30));
    await o.press(Button.Right);
    expect(row1(o)).toBe("I 1 V 2 T 6".padEnd(30));
    o.unmount();
  });

  test("score follows record writes seen through the pure helper", async () => {
    const o = await bootPureHelper();
    await o.press(Button.Right); // cursor 1
    await o.press(Button.A); // cells[1].k 2 -> 3
    expect(row1(o)).toBe("I 1 V 3 T 7".padEnd(30));
    expect(row0(o)).toBe("S 7".padEnd(30)); // 1+3+3
    await o.press(Button.Right); // cursor 2
    expect(row1(o)).toBe("I 2 V 3 T 7".padEnd(30));
    await o.press(Button.A); // cells[2].k 3 -> 4
    expect(row1(o)).toBe("I 2 V 4 T 8".padEnd(30));
    expect(row0(o)).toBe("S 8".padEnd(30)); // 1+3+4
    o.unmount();
  });

  test("cursor clamps and helper reads stay consistent", async () => {
    const o = await bootPureHelper();
    await o.press(Button.Left); // clamped at 0
    expect(row1(o)).toBe("I 0 V 1 T 6".padEnd(30));
    await o.press(Button.A); // cells[0].k 1 -> 2
    expect(row0(o)).toBe("S 7".padEnd(30)); // 2+2+3
    expect(row1(o)).toBe("I 0 V 2 T 7".padEnd(30));
    o.unmount();
  });
});

// Parentheses around a call callee are semantically neutral in real Vue:
// `(inc)(x)` runs the same closure as `inc(x)`. The AOT purity/recursion
// gates must therefore accept pure helper chains written with parens while
// still rejecting void/dispatch smuggling (review task 1155; rejects live
// in compiler.test.ts).
describe("parenthesized pure-helper calls under the real Vue oracle", () => {
  const HOST = join(import.meta.dir, "..", "host", "input.ts");
  const APP_TSX = `
import { computed, ref } from "vue";
import { Button, onButton } from "${HOST}";
export default () => {
  const n = ref(1);
  function inc(x: number): number { return x + 1; }
  function quad(x: number): number { return ((inc))((inc)(x)) + (inc)(inc(x)); }
  onButton((b) => {
    if (b === Button.A) n.value = quad(n.value);
    if (b === Button.B) n.value = 1;
  });
  return (<><row y={0}>N {n.value} Q {quad(0)}</row></>);
};
`;
  const ENTRY_TS = `
import { createVaporApp, nextTick } from "vue";
import App from "./app.tsx";
import { __dispatchButton, __resetButtons } from "${HOST}";
const hooks = globalThis as Record<string, unknown>;
hooks.__vaporBoot = (container: unknown) => {
  __resetButtons();
  const app = (createVaporApp as unknown as (c: unknown) => { mount(c: unknown): void; unmount(): void })({
    setup: () => (App as () => unknown)(),
  });
  app.mount(container);
  return app;
};
hooks.__vaporPress = (button: number): void => { __dispatchButton(button); };
hooks.__vaporAxisDelta = (): void => {};
hooks.__vaporTick = (): Promise<void> => nextTick();
`;

  async function bootParenOracle(): Promise<{ o: Oracle; cleanup: () => Promise<void> }> {
    const dir = await mkdtemp(join(tmpdir(), "pocket-vapor-oracle-paren-"));
    await writeFile(join(dir, "app.tsx"), APP_TSX);
    await writeFile(join(dir, "entry.ts"), ENTRY_TS);
    // the same source must pass the AOT frontend and lower to direct calls;
    // if analysis ever skips parenthesized callees again, either the gate
    // breaks or the generated C stops calling fn_inc.
    const compiled = compileVaporApp(join(dir, "app.tsx"), APP_TSX, "PAREN HELPER", "gba");
    expect(compiled.c).toContain("fn_inc(fn_inc(p_x)) + fn_inc(fn_inc(p_x))");
    const o = await bootOracle({ width: 30, height: 20, styles: compiled.styles, entry: join(dir, "entry.ts") });
    return { o, cleanup: () => rm(dir, { recursive: true, force: true }) };
  }

  test("quad renders 4 and A applies the paren-written helper chain like Vue", async () => {
    const { o, cleanup } = await bootParenOracle();
    try {
      expect(o.grid().chars[0]).toBe("N 1 Q 4".padEnd(30)); // quad(0) = inc(inc(0)) * 2
      await o.press(Button.A); // quad(1) = 3 + 3
      expect(o.grid().chars[0]).toBe("N 6 Q 4".padEnd(30));
      await o.press(Button.A); // quad(6) = 8 + 8
      expect(o.grid().chars[0]).toBe("N 16 Q 4".padEnd(30));
      await o.press(Button.B); // reset
      expect(o.grid().chars[0]).toBe("N 1 Q 4".padEnd(30));
      o.unmount();
    } finally {
      await cleanup();
    }
  });
});

// Cross-file const module imports behave identically under the real Vue
// Vapor oracle: the local `./levels.ts` is an ordinary TS module on the
// oracle side, and the AOT compiler folds the same consts (fleet task 1002).
describe("local const module import under the real Vue oracle", () => {
  const LEVELS_TS = `
export const BW = 10;
export const ROWS = ["####", "#@$.#", "####"];
// void subset helper: same rules as an in-file helper
export function noop(d: number) { if (d < 0) { return; } }
`;

  const APP_TSX = `
import { computed, ref } from "vue";
import { Button, onButton } from "${join(import.meta.dir, "..", "host", "input.ts")}";
import { BW, ROWS, noop } from "./levels.ts";
export default () => {
  const count = ref(0);
  onButton((b) => {
    if (b === Button.A) { count.value = count.value + 1; noop(count.value); }
    if (b === Button.B) count.value = 0;
  });
  return (
    <>
      <row y={0}>{ROWS[count.value % ROWS.length]}</row>
      <row y={1}>BW={BW} N={ROWS.length}</row>
    </>
  );
};
`;

  const HOST = join(import.meta.dir, "..", "host", "input.ts");

  const ENTRY_TS = `
import { createVaporApp, nextTick } from "vue";
import App from "./app.tsx";
import { __dispatchButton, __resetButtons } from "${HOST}";
const hooks = globalThis as Record<string, unknown>;
hooks.__vaporBoot = (container: unknown) => {
  __resetButtons();
  const app = (createVaporApp as unknown as (c: unknown) => { mount(c: unknown): void; unmount(): void })({
    setup: () => (App as () => unknown)(),
  });
  app.mount(container);
  return app;
};
hooks.__vaporPress = (button: number): void => { __dispatchButton(button); };
hooks.__vaporAxisDelta = (): void => {};
hooks.__vaporTick = (): Promise<void> => nextTick();
`;

  async function bootImportOracle(): Promise<{ o: Oracle; cleanup: () => Promise<void> }> {
    const dir = await mkdtemp(join(tmpdir(), "pocket-vapor-oracle-import-"));
    await writeFile(join(dir, "levels.ts"), LEVELS_TS);
    await writeFile(join(dir, "app.tsx"), APP_TSX);
    await writeFile(join(dir, "entry.ts"), ENTRY_TS);
    // compile the same app through the AOT frontend: it must accept it and
    // fold BW/ROWS.length exactly like the oracle renders them
    const compiled = compileVaporApp(join(dir, "app.tsx"), APP_TSX, "IMPORT", "gba");
    expect(compiled.c).toContain("vp_ln_int(10)");
    expect(compiled.c).toContain("vp_ln_int(3)");
    expect(compiled.c).toContain("static void fn_m0_noop(s32 p_d)");
    const o = await bootOracle({ width: 30, height: 20, styles: compiled.styles, entry: join(dir, "entry.ts") });
    return { o, cleanup: () => rm(dir, { recursive: true, force: true }) };
  }

  test("cross-file string[] index, .length and number const render like the AOT folds", async () => {
    const { o, cleanup } = await bootImportOracle();
    try {
      expect(o.grid().chars[0]).toBe("####".padEnd(30));
      expect(o.grid().chars[1]).toBe("BW=10 N=3".padEnd(30));
      await o.press(Button.A); // count 0 -> 1
      expect(o.grid().chars[0]).toBe("#@$.#".padEnd(30));
      await o.press(Button.A); // count 1 -> 2
      expect(o.grid().chars[0]).toBe("####".padEnd(30));
      await o.press(Button.A); // wraps 3 % 3 -> 0
      expect(o.grid().chars[0]).toBe("####".padEnd(30));
      await o.press(Button.B); // reset
      expect(o.grid().chars[0]).toBe("####".padEnd(30));
      o.unmount();
    } finally {
      await cleanup();
    }
  });
});

// Imported interfaces are module-scoped: same-named interfaces in two
// modules and an aliased import resolve per import site under real TS/Vue,
// exactly as the AOT frontend now qualifies them (fleet task 1092, review
// task 1024 B1). This is the acceptance counterpart to the rejection tests
// in compiler.test.ts.
describe("module-scoped imported interfaces under the real Vue oracle", () => {
  const HOST = join(import.meta.dir, "..", "host", "input.ts");

  const ENTRY_TS = `
import { createVaporApp, nextTick } from "vue";
import App from "./app.tsx";
import { __resetButtons } from "${HOST}";
const hooks = globalThis as Record<string, unknown>;
hooks.__vaporBoot = (container: unknown) => {
  __resetButtons();
  const app = (createVaporApp as unknown as (c: unknown) => { mount(c: unknown): void; unmount(): void })({
    setup: () => (App as () => unknown)(),
  });
  app.mount(container);
  return app;
};
hooks.__vaporPress = (): void => {};
hooks.__vaporAxisDelta = (): void => {};
hooks.__vaporTick = (): Promise<void> => nextTick();
`;

  test("same-named Cell in two modules keeps each shape; aliased import resolves", async () => {
    // a.ts Cell{x}, b.ts Cell{y}. App imports Cell from a.ts and Cell as
    // Tile from b.ts, rendering both field sets — real Vue resolves them as
    // distinct types and reads distinct properties.
    const aTs = "export interface Cell { x: number }\nexport const AX = 7;\n";
    const bTs = "export interface Cell { y: number }\nexport const BY = 9;\n";
    const appTsx = `
import { computed, ref } from "vue";
import { Button, onButton } from "${HOST}";
import { Cell, AX } from "./a.ts";
import { Cell as Tile, BY } from "./b.ts";
export default () => {
  const xs = ref<Cell[]>([{ x: AX }, { x: AX + 1 }]);
  const ys = ref<Tile[]>([{ y: BY }]);
  onButton((b) => {});
  return (<>
    {xs.value.map((c, i) => <row y={i}>x{c.x}</row>)}
    {ys.value.map((c, i) => <row y={5 + i}>y{c.y}</row>)}
  </>);
};
`;
    const dir = await mkdtemp(join(tmpdir(), "pocket-vapor-oracle-iface-"));
    try {
      await writeFile(join(dir, "a.ts"), aTs);
      await writeFile(join(dir, "b.ts"), bTs);
      await writeFile(join(dir, "app.tsx"), appTsx);
      await writeFile(join(dir, "entry.ts"), ENTRY_TS);
      // AOT accepts and emits two distinct module-qualified records.
      const compiled = compileVaporApp(join(dir, "app.tsx"), appTsx, "IFACE", "gba");
      expect(compiled.c).toContain("typedef struct { s32 x; } rec_m0_cell;");
      expect(compiled.c).toContain("typedef struct { s32 y; } rec_m1_cell;");
      const o = await bootOracle({ width: 30, height: 20, styles: compiled.styles, entry: join(dir, "entry.ts") });
      expect(o.grid().chars[0]).toBe("x7".padEnd(30));
      expect(o.grid().chars[1]).toBe("x8".padEnd(30));
      expect(o.grid().chars[5]).toBe("y9".padEnd(30));
      o.unmount();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
