// vapor/test/compiler.test.ts — subset diagnostics + deterministic output.

import { describe, expect, test } from "bun:test";
import { $ } from "bun";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadBoard } from "../compiler/boards.ts";
import { compileVaporApp, VAPOR_TARGETS, VaporCompileError } from "../compiler/compile.ts";
import { esp32BuildId } from "../compiler/esp32.ts";
import { FONT8 } from "../compiler/font.gen.ts";
import { buildRom } from "../compiler/rom.ts";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const HOST_INPUT = join(import.meta.dir, "..", "host", "input.ts");

const ENTRY = join(import.meta.dir, "..", "examples", "todo", "todo.tsx");
const TODO_SOURCE = await Bun.file(ENTRY).text();

const HEADER = `
import { computed, ref } from "vue";
import { Button, onButton } from "../../host/input.ts";
`;

function minimal(body: string, jsx = "<row y={0}>{count.value}</row>"): string {
  return `${HEADER}
export default () => {
  const count = ref(0);
  ${body}
  onButton((b) => {
    if (b === Button.A) count.value = count.value + 1;
  });
  return (
    <>
      ${jsx}
    </>
  );
};
`;
}

function compileErr(source: string): string {
  try {
    compileVaporApp("test.tsx", source);
  } catch (e) {
    expect(e).toBeInstanceOf(VaporCompileError);
    return (e as Error).message;
  }
  throw new Error("expected a VaporCompileError");
}

describe("pocket vapor compiler", () => {
  test("compiles the todo example deterministically", async () => {
    const source = await Bun.file(ENTRY).text();
    const a = compileVaporApp(ENTRY, source, "VAPOR TODO");
    const b = compileVaporApp(ENTRY, source, "VAPOR TODO");
    expect(a.c).toBe(b.c);
    expect(a.c).toContain("vp_mark");
    expect(a.graph).toContain("visible: view(maxLen 12)");
    expect(a.plan).toContain("pools");
  });

  test("esp32 uses its 20x18 display grid and emits 1bpp RGB565 data", () => {
    expect(VAPOR_TARGETS.esp32).toEqual({
      name: "esp32",
      width: 20,
      height: 18,
      poolCap: 32,
      strCap: 24,
    });

    const compiled = compileVaporApp(
      "esp32.tsx",
      minimal("", '<row y={0} class="text-[#ff0000] bg-[#00ff00]">{count.value}</row>'),
      "ESP32",
      "esp32",
    );
    expect(compiled.c).toContain("/* target: esp32 (20x18) */");
    expect(compiled.c).toContain("#define VP_STR_CAP 24");
    expect(compiled.c).toContain("#define VP_VIEW_CAP 32");

    const font = compiled.c.match(/const u8 vp_font_tiles\[\] = \{ ([^}]*) \};/);
    expect(font).not.toBeNull();
    const fontBytes = font![1].split(",").map(Number);
    expect(fontBytes).toHaveLength(95 * 8);
    expect(fontBytes).toEqual(FONT8.flat());

    const ink = compiled.c.match(/const u16 vp_ink565\[\] = \{ ([^}]*) \};/);
    const paper = compiled.c.match(/const u16 vp_paper565\[\] = \{ ([^}]*) \};/);
    expect(ink).not.toBeNull();
    expect(paper).not.toBeNull();
    expect(ink![1].split(",").map(Number)).toEqual([59262, 0xf800]);
    expect(paper![1].split(",").map(Number)).toEqual([0x10a4, 0x07e0]);
    expect(compiled.c).toContain("const u16 vp_backdrop = 4260;");
    expect(compiled.c).toContain("const u8 vp_pal_style[2] = { 0,1 };");
    expect(compiled.plan).toContain("760 B font + 12 B style data");
  });

  test("esp32 build identity is deterministic, source- and board-sensitive", async () => {
    const app = compileVaporApp("esp32.tsx", minimal(""), "ESP32", "esp32");
    const same = compileVaporApp("esp32.tsx", minimal(""), "ESP32", "esp32");
    const changed = compileVaporApp(
      "esp32.tsx",
      minimal("").replace("count.value + 1", "count.value + 2"),
      "ESP32",
      "esp32",
    );

    const board = loadBoard("meowbit");
    const id = await esp32BuildId(app, board);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(await esp32BuildId(same, board)).toBe(id);
    expect(await esp32BuildId(changed, board)).not.toBe(id);

    const rewired = structuredClone(board);
    rewired.input.pins.b = 14;
    expect(await esp32BuildId(app, rewired)).not.toBe(id);
  });

  test("effect masks subscribe conditional reads on both arms", async () => {
    const source = await Bun.file(ENTRY).text();
    const app = compileVaporApp(ENTRY, source);
    // the footer reads only `editing`; the list block reads todos+cursor+filter
    expect(app.graph).toMatch(/eff_\d+: rows \[19, 20\) mask 0x8 \{editing\}/);
    expect(app.graph).toMatch(/rows \[3, 15\) mask 0x7 \{todos, cursor, filter\}/);
  });

  test("rejects loose equality", () => {
    const msg = compileErr(minimal("", "<row y={0}>{count.value == 1 ? 'a' : 'b'}</row>"));
    expect(msg).toContain("===");
  });

  test("rejects dynamic row y outside map", () => {
    const msg = compileErr(minimal("", "<row y={count.value}>{'X'}</row>"));
    expect(msg).toContain("compile-time constant");
  });

  test("rejects unknown vue imports", () => {
    const msg = compileErr(`
import { ref, computed, watch } from "vue";
import { Button, onButton } from "../../host/input.ts";
export default () => {
  const count = ref(0);
  onButton((b) => { count.value = 1; });
  return (<><row y={0}>{count.value}</row></>);
};
`);
    expect(msg).toContain("watch");
  });

  test("rejects computeds that read later computeds", () => {
    const msg = compileErr(minimal("const a = computed(() => b.value + 1);\n  const b = computed(() => count.value);"));
    expect(msg).toContain(".value on non-reactive: b");
  });

  test("rejects list refs without an interface annotation", () => {
    const msg = compileErr(`${HEADER}
export default () => {
  const items = ref([{ text: "A", done: false }]);
  onButton((b) => {});
  return (<><row y={0}>{items.value.length}</row></>);
};
`);
    expect(msg).toContain("ref<T[]>");
  });

  test("errors carry file:line:col", () => {
    const msg = compileErr(minimal("", "<row y={0}>{count.value == 1 ? 'a' : 'b'}</row>"));
    expect(msg).toMatch(/^test\.tsx:\d+:\d+/);
  });

  test("keymaps compile to ROM fnptr tables with null holes", async () => {
    const source = await Bun.file(ENTRY).text();
    const app = compileVaporApp(ENTRY, source);
    expect(app.c).toMatch(/static void \(\*const KM_listKeys\[10\]\)\(void\) = \{ .*km_listKeys_6.* \};/);
    expect(app.c).toContain("KM_editKeys");
    expect(app.c).toMatch(/\? KM_editKeys : KM_listKeys/); // dispatch ternary
    expect(app.c).toContain("fn_closeEditor"); // bare fn reference as keymap value
  });

  test("computed can yield a record reference (current todo)", async () => {
    const source = await Bun.file(ENTRY).text();
    const app = compileVaporApp(ENTRY, source);
    expect(app.graph).toContain("current: obj <- {cursor, filter, todos}");
    expect(app.c).toContain("static rec_todo * c_current_v;");
  });

  test("splice/indexOf remain in the subset", () => {
    const source = `${HEADER}
interface It { text: string; done: boolean }
export default () => {
  const items = ref<It[]>([{ text: "A", done: false }]);
  onButton((b) => {
    const t = items.value[0];
    if (t) items.value.splice(items.value.indexOf(t), 1);
  });
  return (<><row y={0}>{items.value.length}</row></>);
};
`;
    const app = compileVaporApp("test.tsx", source);
    expect(app.c).toContain("g_items_len--");
  });

  test("rejects keymap keys that are not compile-time constants", () => {
    const msg = compileErr(minimal("const keys = { [count.value]: () => {} };"));
    expect(msg).toContain("compile-time Button constants");
  });

  test("rejects helper params without a number annotation", () => {
    const msg = compileErr(minimal("function move(d) { count.value = count.value + d; }"));
    expect(msg).toContain("annotated `: number`");
  });

  test("pure number helpers compile to s32 functions usable in render and if", () => {
    const source = `${HEADER}
interface Cell { k: number }
export default () => {
  const cells = ref<Cell[]>([{ k: 1 }, { k: 2 }, { k: 3 }]);
  const cur = ref(0);
  function codeAt(i: number): number {
    const c = cells.value[i];
    if (c) return c.k;
    return 0;
  }
  function score(): number {
    return codeAt(0) + codeAt(1) + codeAt(2);
  }
  // boolean params are accepted and lower to s32 just like number params
  function isWall(i: number, want: boolean): number {
    if (want) return codeAt(i) * 2;
    return codeAt(i);
  }
  onButton((b) => {
    if (b === Button.A) {
      const c = cells.value[cur.value];
      if (c) c.k = c.k + 1;
    } else if (b === Button.Right) cur.value = cur.value + 1;
  });
  return (
    <>
      <row y={0}>{"SCORE "}{score()}</row>
      <row y={1}>{isWall(cur.value, cur.value === 0)}</row>
    </>
  );
};
`;
    const app = compileVaporApp("test.tsx", source);
    expect(app.c).toContain("static s32 fn_codeAt(s32 p_i) {");
    expect(app.c).toContain("static s32 fn_score(void) {");
    // result used as a render expression
    expect(app.c).toMatch(/vp_ln_int\(fn_score\(\)\)/);
    // result used in an if condition inside another helper
    expect(app.c).toMatch(/if \(p_want\)/);
    expect(app.c).toMatch(/fn_codeAt\(p_i\) \* 2/);
    // bool params lower to s32 like number params
    expect(app.c).toContain("static s32 fn_isWall(s32 p_i, s32 p_want)");
  });

  test("rejects number helpers that write a ref", () => {
    const source = `${HEADER}
export default () => {
  const count = ref(0);
  function bad(): number { count.value = 1; return count.value; }
  onButton((b) => { count.value = bad(); });
  return (<><row y={0}>{bad()}</row></>);
};
`;
    expect(compileErr(source)).toContain("helpers that return a number must be pure");
  });

  test("rejects number helpers that write a record field", () => {
    const source = `${HEADER}
interface It { k: number }
export default () => {
  const items = ref<It[]>([{ k: 1 }]);
  function bad(): number {
    const t = items.value[0];
    if (t) t.k = 2;
    return 0;
  }
  onButton((b) => {});
  return (<><row y={0}>{bad()}</row></>);
};
`;
    expect(compileErr(source)).toContain("helpers that return a number must be pure");
  });

  test("rejects number helpers that push or splice a list", () => {
    const head = `${HEADER}
interface It { k: number }
export default () => {
  const items = ref<It[]>([{ k: 1 }]);`;
    const tail = `onButton((b) => {});
  return (<><row y={0}>{bad()}</row></>);
};
`;
    const pushSrc = `${head}
  function bad(): number { items.value.push({ k: 2 }); return items.value.length; }
  ${tail}`;
    expect(compileErr(pushSrc)).toContain("helpers that return a number must be pure");
    const spliceSrc = `${head}
  function bad(): number { const t = items.value[0]; if (t) items.value.splice(0, 1); return 0; }
  ${tail}`;
    expect(compileErr(spliceSrc)).toContain("helpers that return a number must be pure");
  });

  test("rejects impure helpers called transitively from a number helper", () => {
    const source = `${HEADER}
export default () => {
  const count = ref(0);
  function writer(): number { count.value = 1; return count.value; }
  function reader(): number { return writer() + 1; }
  onButton((b) => {});
  return (<><row y={0}>{reader()}</row></>);
};
`;
    expect(compileErr(source)).toContain("helpers that return a number must be pure");
  });

  test("rejects helper params that are not number or boolean", () => {
    const source = `${HEADER}
export default () => {
  const count = ref(0);
  function bad(s: string): number { return s.length; }
  onButton((b) => {});
  return (<><row y={0}>{count.value}</row></>);
};
`;
    expect(compileErr(source)).toContain("annotated `: number` or `: boolean`");
  });

  test("rejects non-number helper return annotations", () => {
    const source = `${HEADER}
export default () => {
  const count = ref(0);
  function bad(): boolean { return count.value === 0; }
  onButton((b) => {});
  return (<><row y={0}>{count.value}</row></>);
};
`;
    expect(compileErr(source)).toContain("helper return type must be `: number`");
  });

  test("rejects a number helper that never returns a value", () => {
    const source = `${HEADER}
export default () => {
  const count = ref(0);
  function bad(): number { count.value = count.value + 1; }
  onButton((b) => {});
  return (<><row y={0}>{count.value}</row></>);
};
`;
    expect(compileErr(source)).toContain("declares `: number` but never returns a value");
  });

  test("rejects value returns in the onButton handler and keymap arrows", () => {
    const handlerSrc = `${HEADER}
export default () => {
  const count = ref(0);
  onButton((b) => { return 1; });
  return (<><row y={0}>{count.value}</row></>);
};
`;
    expect(compileErr(handlerSrc)).toContain("cannot return values");
    const kmSrc = `${HEADER}
export default () => {
  const count = ref(0);
  function f(): number { return 1; }
  const keys = { [Button.A]: f };
  onButton((b) => keys[b]?.());
  return (<><row y={0}>{count.value}</row></>);
};
`;
    expect(compileErr(kmSrc)).toContain("keymap");
  });

  test("rejects recursion through helper call cycles", () => {
    const direct = `${HEADER}
export default () => {
  const count = ref(0);
  function f(n: number): number { return f(n - 1); }
  onButton((b) => {});
  return (<><row y={0}>{f(0)}</row></>);
};
`;
    expect(compileErr(direct)).toContain("recursive");
    const mutual = `${HEADER}
export default () => {
  const count = ref(0);
  function a(): void { b(); }
  function b(): void { a(); }
  onButton((b2) => { a(); });
  return (<><row y={0}>{count.value}</row></>);
};
`;
    expect(compileErr(mutual)).toContain("recursive");
  });

  test("rejects a number helper calling a void helper", () => {
    const source = `${HEADER}
export default () => {
  const count = ref(0);
  function side(): void { count.value = count.value + 1; }
  function pure(): number { side(); return count.value; }
  onButton((b) => {});
  return (<><row y={0}>{pure()}</row></>);
};
`;
    expect(compileErr(source)).toContain("void helper");
  });

  test("rejects a number helper that smuggles a write through keymap dispatch", () => {
    // KM[i]?.() is an element-access call: the static analyzer cannot see
    // which void action runs, so it must count as a possible write. Without
    // this gate a render effect could mutate refs via a "pure" helper.
    const source = `${HEADER}
export default () => {
  const count = ref(0);
  function bump(): void { count.value = count.value + 1; }
  const KM = { [Button.A]: bump };
  function sneaky(t: number): number {
    KM[Button.A]?.();
    return t + 1;
  }
  onButton((b) => {});
  return (<><row y={0}>{sneaky(count.value)}</row></>);
};
`;
    expect(compileErr(source)).toContain("must be pure");
  });

  test("pure number helpers may still call pure property-access builtins", () => {
    // the keymap-dispatch gate targets element-access calls only;
    // Math.max/min and list.indexOf stay available inside number helpers
    const source = `${HEADER}
interface It { k: number }
export default () => {
  const items = ref<It[]>([{ k: 1 }, { k: 2 }]);
  function clamped(x: number): number { return Math.max(0, Math.min(9, x)); }
  onButton((b) => {});
  return (<><row y={0}>{clamped(items.value.length)}</row></>);
};
`;
    const app = compileVaporApp("test.tsx", source);
    expect(app.c).toContain("static s32 fn_clamped(s32 p_x) {");
    expect(app.c).toMatch(/vp_max\(0, vp_min\(9, p_x\)\)/);
  });

  test("rejects a number helper that only returns on some paths", () => {
    // an if without an else can fall through; the emitted s32 function must
    // never reach its end without returning
    const source = `${HEADER}
export default () => {
  const count = ref(0);
  function half(x: number): number { if (x > 0) { return x - 1; } }
  onButton((b) => {});
  return (<><row y={0}>{half(count.value)}</row></>);
};
`;
    expect(compileErr(source)).toContain("can reach the end without returning a value");
  });

  test("parenthesized callee cannot hide a void call from a number helper", () => {
    // review task 1155 R1: the code generator strips parens from the callee,
    // so analysis must classify `(side)()` exactly like `side()`. One or
    // many paren layers must not smuggle a void-helper call into a pure
    // number helper.
    const head = `${HEADER}
export default () => {
  const count = ref(0);
  function side(): void { count.value = count.value + 1; }
  function pure(x: number): number {`;
    const tail = ` return x + 1; }
  onButton((b) => {});
  return (<><row y={0}>{pure(count.value)}</row></>);
};
`;
    expect(compileErr(`${head} side();${tail}`)).toMatch(/^test\.tsx:\d+:\d+ .*void helper/);
    expect(compileErr(`${head} (side)();${tail}`)).toContain("void helper");
    expect(compileErr(`${head} ((side))();${tail}`)).toContain("void helper");
    expect(compileErr(`${head} (side)?.();${tail}`)).toContain("void helper");
  });

  test("parenthesized push/splice and keymap dispatch still trip the purity gate", () => {
    const listHead = `${HEADER}
interface It { k: number }
export default () => {
  const items = ref<It[]>([{ k: 1 }]);`;
    const listTail = `onButton((b) => {});
  return (<><row y={0}>{size()}</row></>);
};
`;
    expect(
      compileErr(`${listHead}
  function size(): number { (items.value.push)({ k: 2 }); return items.value.length; }
  ${listTail}`),
    ).toContain("must be pure");
    expect(
      compileErr(`${listHead}
  function size(): number { ((items.value.splice))(0, 1); return items.value.length; }
  ${listTail}`),
    ).toContain("must be pure");
    const kmHead = `${HEADER}
export default () => {
  const count = ref(0);
  function bump(): void { count.value = count.value + 1; }
  const KM = { [Button.A]: bump };
  function sneaky(t: number): number {`;
    const kmTail = ` return t + 1; }
  onButton((b) => {});
  return (<><row y={0}>{sneaky(count.value)}</row></>);
};
`;
    expect(compileErr(`${kmHead} (KM[Button.A])?.();${kmTail}`)).toContain("must be pure");
    expect(compileErr(`${kmHead} ((KM[Button.A]))();${kmTail}`)).toContain("must be pure");
  });

  test("parenthesized self-call still closes the recursion graph", () => {
    const head = `${HEADER}
export default () => {
  function down(n: number): number { if (n < 1) return 0; return`;
    const tail = `; }
  onButton((b) => {});
  return (<><row y={0}>{down(3)}</row></>);
};
`;
    expect(compileErr(`${head} down(n - 1)${tail}`)).toContain("recursive");
    expect(compileErr(`${head} (down)(n - 1)${tail}`)).toContain("recursive");
    expect(compileErr(`${head} ((down))((n - 1))${tail}`)).toContain("recursive");
  });

  test("parenthesized calls between pure number helpers are accepted", () => {
    // parens around a callee are semantically neutral in Vue; pure helper
    // chains through parens must compile to the same direct C calls.
    const source = `${HEADER}
export default () => {
  const count = ref(1);
  function inc(x: number): number { return x + 1; }
  function quad(x: number): number { return ((inc))((inc)(x)) + (inc)(inc(x)); }
  onButton((b) => { if (b === Button.A) count.value = quad(count.value); });
  return (<><row y={0}>N {count.value} Q {quad(0)}</row></>);
};
`;
    const app = compileVaporApp("test.tsx", source);
    expect(app.c).toMatch(/static s32 fn_quad\(s32 p_x\) \{[^}]*fn_inc\(fn_inc\(p_x\)\) \+ fn_inc\(fn_inc\(p_x\)\)/s);
    expect(app.c).toContain("vp_ln_int(fn_quad(0))");
  });

  test("components inline to zero-cost paint code", async () => {
    const source = await Bun.file(ENTRY).text();
    const app = compileVaporApp(ENTRY, source);
    // six components, yet the graph is unchanged: TitleBar folds to a static
    // boot-painted row, the rest merge into the same four effects
    expect(app.graph.match(/eff_\d+:/g)?.length).toBe(4);
    expect(app.c).not.toContain("TitleBar");
    expect(app.graph).toMatch(/rows \[3, 15\) mask 0x7 \{todos, cursor, filter\}/);
  });

  test("rejects props that collide with row attributes", () => {
    const msg = compileErr(`${HEADER}
function Bad(props: { y: number }) {
  return (<row y={props.y}>{"A"}</row>);
}
export default () => {
  const count = ref(0);
  onButton((b) => { count.value = 1; });
  return (<><Bad y={0} /></>);
};
`);
    expect(msg).toContain('collides with a <row> attribute');
  });

  test("rejects unknown and missing props", () => {
    const comp = `
function Line(props: { line: number; text: string }) {
  return (<row y={props.line}>{props.text}</row>);
}
`;
    const unknown = compileErr(`${HEADER}${comp}
export default () => {
  const count = ref(0);
  onButton((b) => { count.value = 1; });
  return (<><Line line={0} text="A" extra={1} /></>);
};
`);
    expect(unknown).toContain("unknown prop extra");
    const missing = compileErr(`${HEADER}${comp}
export default () => {
  const count = ref(0);
  onButton((b) => { count.value = 1; });
  return (<><Line line={0} /></>);
};
`);
    expect(missing).toContain("missing prop text");
  });

  test("rejects list assignment from a different list", () => {
    const source = `${HEADER}
interface It { text: string; done: boolean }
export default () => {
  const a = ref<It[]>([]);
  const b2 = ref<It[]>([]);
  onButton((b) => {
    a.value = b2.value.filter((t) => !t.done);
  });
  return (<><row y={0}>{a.value.length}</row></>);
};
`;
    const msg = compileErr(source);
    expect(msg).toContain("derive from the same list");
  });
});

// Record string fields are pooled `vp_sb` structs; a dynamic index reads one
// byte through vp_sb_at (space sentinel out of range, same as vp_char_at).
describe("record string field indexed read", () => {
  const BOARD = `${HEADER}
interface Line { text: string }
export default () => {
  const rows = ref<Line[]>([{ text: "abc" }, { text: "xyz" }]);
  const x = ref(1);
  onButton((b) => { if (b === Button.A) x.value = 2; });
  return (<>{rows.value.map((rr, i) => <row y={i}>{rr.text[x.value]}</row>)}</>);
};
`;

  test("renders a dynamic char read through vp_sb_at (render path)", () => {
    const app = compileVaporApp("board.tsx", BOARD, "BOARD", "gba");
    expect(app.c).toContain("vp_sb_at(");
    // the map-row record field is read one byte at a time as a char
    expect(app.c).toMatch(/vp_ln_ch\(vp_sb_at\(&t\d+->text, g_x\)\)/);
    // the map effect subscribes to rows (pool) and x (index ref)
    expect(app.graph).toMatch(/mask 0x[0-9a-f]+ \{rows, x\}|mask 0x[0-9a-f]+ \{x, rows\}/);
  });

  test("vp_sb_at reads inside an if-condition and on a standalone string ref", () => {
    const source = `${HEADER}
const CH = "#.";
interface Line { text: string }
export default () => {
  const rows = ref<Line[]>([{ text: "#." }]);
  const scratch = ref("AB");
  const x = ref(0);
  onButton((b) => {
    if (b === Button.A) x.value = 1;
    const t = rows.value[0];
    if (t && t.text[x.value] === CH[0]) scratch.value = "hit";
  });
  return (<><row y={0}>{scratch.value[x.value]}</row></>);
};
`;
    const app = compileVaporApp("board.tsx", source, "BOARD", "gba");
    // record field char compared to a ROM const-string char (Sokoban form)
    expect(app.c).toMatch(/vp_sb_at\(&l_t_\d+->text, g_x\) == vp_char_at\(S\d+, 2, 0\)/);
    // dynamic index also works on a standalone ref<string>
    expect(app.c).toContain("vp_sb_at(&g_scratch, g_x)");
  });

  test("out-of-range read is the space sentinel (bounded, no tripwire)", () => {
    const app = compileVaporApp("board.tsx", BOARD, "BOARD", "gba");
    // the inline lives in the emitted C with the same contract as vp_char_at
    expect(app.c).toContain(
      "static inline char VP_UNUSED_FN vp_sb_at(const vp_sb *s, s32 i) { return (i >= 0 && i < (s32)s->len) ? s->b[i] : ' '; }",
    );
  });

  test("rejects indexing a number record field", () => {
    const source = `${HEADER}
interface Cell { k: number }
export default () => {
  const cells = ref<Cell[]>([{ k: 1 }]);
  const x = ref(0);
  onButton((b) => {});
  return (<><row y={0}>{cells.value[0] ? cells.value[0].k[x.value] : 0}</row></>);
};
`;
    const msg = compileErr(source);
    expect(msg).toContain("indexing number/boolean record fields is not supported");
    expect(msg).toMatch(/^test\.tsx:\d+:\d+/);
  });

  test("todo omits the vp_sb_at definition and call site entirely", () => {
    // vp_sb_at/vp_sb_put are emitted ON DEMAND (a compile-time use flag):
    // gcc/cc65 dead-strip an unused static inline, but sdcc (GB) compiles it
    // into gen_app.rel and sdld keeps the whole object — todo's GB _CODE grew
    // 184 B while the inline was emitted unconditionally (reviewer 1094 F1).
    for (const target of ["gba", "gb", "nes", "esp32"] as const) {
      const app = compileVaporApp("todo.tsx", TODO_SOURCE, "VAPOR TODO", target);
      expect(app.c).not.toContain("vp_sb_at");
      expect(app.c).not.toContain("vp_sb_put");
    }
  });
});

// In-place one-byte writes go through the amphibious putChar host helper:
// under real Vue it rebuilds an immutable string, the compiler lowers the
// exact `t.s = putChar(t.s, i, ch)` shape to one in-place vp_sb_put + mark.
describe("record string field in-place write (putChar)", () => {
  const WRITE = `${HEADER}
import { putChar } from "../../host/text.ts";
const CH = "#$";
interface Line { text: string }
export default () => {
  const rows = ref<Line[]>([{ text: "abc" }]);
  const x = ref(0);
  onButton((b) => {
    if (b === Button.Right) x.value = 2;
    if (b === Button.A) {
      const t = rows.value[0];
      if (t) t.text = putChar(t.text, x.value, CH[1]);
    }
  });
  return (<>{rows.value.map((rr, i) => <row y={i}>{rr.text}</row>)}</>);
};
`;

  test("lowers to vp_sb_put + vp_mark with no slice rebuild or overlay temp", () => {
    const app = compileVaporApp("write.tsx", WRITE, "WRITE", "gba");
    expect(app.c).toMatch(
      /if \(vp_sb_put\(&l_t_\d+->text, g_x, vp_char_at\(S\d+, 2, 1\)\)\) vp_mark\(0\);/,
    );
    // one in-place byte store, not the slice+ch+slice string-builder path
    expect(app.c).not.toContain("vp_sb_slice");
    expect(app.c).not.toMatch(/ovl_sb/);
  });

  test("accepts a one-character literal as the char", () => {
    const source = `${HEADER}
import { putChar } from "../../host/text.ts";
interface Line { text: string }
export default () => {
  const rows = ref<Line[]>([{ text: "abc" }]);
  onButton((b) => {
    const t = rows.value[0];
    if (t) t.text = putChar(t.text, 1, "Z");
  });
  return (<>{rows.value.map((rr, i) => <row y={i}>{rr.text}</row>)}</>);
};
`;
    const app = compileVaporApp("write.tsx", source, "WRITE", "gba");
    expect(app.c).toMatch(/vp_sb_put\(&l_t_\d+->text, 1, 'Z'\)/);
  });

  test("rejects a multi-char literal as the char", () => {
    const source = `${HEADER}
import { putChar } from "../../host/text.ts";
interface Line { text: string }
export default () => {
  const rows = ref<Line[]>([{ text: "abc" }]);
  onButton((b) => {
    const t = rows.value[0];
    if (t) t.text = putChar(t.text, 1, "XY");
  });
  return (<><row y={0}>{""}</row></>);
};
`;
    const msg = compileErr(source);
    expect(msg).toContain("putChar char must be one character");
  });

  test("rejects a non-char (number) as the char", () => {
    const source = `${HEADER}
import { putChar } from "../../host/text.ts";
interface Line { text: string }
export default () => {
  const rows = ref<Line[]>([{ text: "abc" }]);
  const n = ref(0);
  onButton((b) => {
    const t = rows.value[0];
    if (t) t.text = putChar(t.text, 1, n.value);
  });
  return (<><row y={0}>{""}</row></>);
};
`;
    const msg = compileErr(source);
    expect(msg).toContain("putChar char must be a single char");
  });

  test("rejects putChar editing a field other than the assigned one", () => {
    const source = `${HEADER}
import { putChar } from "../../host/text.ts";
interface Line { text: string }
export default () => {
  const rows = ref<Line[]>([{ text: "abc" }]);
  onButton((b) => {
    const t = rows.value[0];
    if (t) t.text = putChar("xyz", 1, "Z");
  });
  return (<><row y={0}>{""}</row></>);
};
`;
    const msg = compileErr(source);
    expect(msg).toContain("putChar must edit the assigned field");
  });

  test("rejects direct indexed string assignment (a Vue no-op)", () => {
    const source = `${HEADER}
interface Line { text: string }
export default () => {
  const rows = ref<Line[]>([{ text: "abc" }]);
  onButton((b) => {
    const t = rows.value[0];
    if (t) t.text[1] = "Z";
  });
  return (<><row y={0}>{""}</row></>);
};
`;
    const msg = compileErr(source);
    expect(msg).toContain("indexed string assignment is a no-op in Vue");
  });

  test("plain string-field assignment still says use push/putChar", () => {
    const source = `${HEADER}
interface Line { text: string }
export default () => {
  const rows = ref<Line[]>([{ text: "abc" }]);
  onButton((b) => {
    const t = rows.value[0];
    if (t) t.text = "zzz";
  });
  return (<><row y={0}>{""}</row></>);
};
`;
    const msg = compileErr(source);
    expect(msg).toContain("string field writes only via push");
  });
});

// F3 (reviewer 1094): a record pointer from a pool index expression is null
// at runtime when the index is out of range. Field writes through it used to
// dereference address 0 and hang the GBA; they now skip + trip VP_TRIP_NULL.
describe("null record pointer write guards", () => {
  test("unguarded putChar through an out-of-range pointer is null-guarded", () => {
    const source = `${HEADER}
import { putChar } from "../../host/text.ts";
interface Line { text: string }
export default () => {
  const rows = ref<Line[]>([{ text: "abc" }]);
  onButton((b) => {
    const ln = rows.value[3];
    ln.text = putChar(ln.text, 0, "Z");
  });
  return (<><row y={0}>{""}</row></>);
};
`;
    const app = compileVaporApp("n.tsx", source, "N", "gba");
    expect(app.c).toMatch(
      /if \(!l_ln_\d+\) vp_tripwires \|= VP_TRIP_NULL; else if \(vp_sb_put\(&l_ln_\d+->text, 0, 'Z'\)\) vp_mark\(0\);/,
    );
  });

  test("unguarded number-field write through an out-of-range pointer is null-guarded", () => {
    const source = `${HEADER}
interface Line { text: string; n: number }
export default () => {
  const rows = ref<Line[]>([{ text: "abc", n: 1 }]);
  onButton((b) => {
    const ln = rows.value[3];
    ln.n = 7;
  });
  return (<><row y={0}>{""}</row></>);
};
`;
    const app = compileVaporApp("n.tsx", source, "N", "gba");
    expect(app.c).toContain("if (!l_ln_");
    expect(app.c).toMatch(/if \(!l_ln_\d+\) vp_tripwires \|= VP_TRIP_NULL; else \{ s32 fv\d+ = \(s32\)\(7\);/);
  });

  test("an inline indexing write guards the indexing ternary pointer", () => {
    const source = `${HEADER}
interface Line { text: string; n: number }
export default () => {
  const rows = ref<Line[]>([{ text: "abc", n: 1 }]);
  onButton((b) => { rows.value[3].n = 7; });
  return (<><row y={0}>{""}</row></>);
};
`;
    const app = compileVaporApp("n.tsx", source, "N", "gba");
    // the indexing ternary's pointer tmp is tested once, then written through
    expect(app.c).toContain(
      "e0 = (3 >= 0 && 3 < (s32)g_rows_len) ? g_rows + (u16)((u8)(3)) : 0;",
    );
    expect(app.c).toContain("if (!e0) vp_tripwires |= VP_TRIP_NULL; else { s32 fv");
  });

  test("the `if (t)` idiom narrows the pointer and needs no runtime guard", () => {
    const source = `${HEADER}
interface Line { text: string; n: number }
export default () => {
  const rows = ref<Line[]>([{ text: "abc", n: 1 }]);
  onButton((b) => {
    const t = rows.value[0];
    if (t) t.n = 7;
  });
  return (<><row y={0}>{""}</row></>);
};
`;
    const app = compileVaporApp("n.tsx", source, "N", "gba");
    expect(app.c).not.toContain("VP_TRIP_NULL");
    expect(app.c).toMatch(/if \(l_t_\d+->n != fv\d+\)/);
  });
});

// char vs one-character string literal: JS sees both as the one-char string
// "#", but in C the left side is a `char` and the literal is a ROM array
// `const char[2]` — sdcc and cc65 reject that comparison outright, gcc only
// warns. The compiler lowers the single-char literal side to a C char
// literal ('#'); a multi-char literal against a char is meaningless and is a
// frontend diagnostic instead.
describe("char compared to a one-character string literal (D207)", () => {
  const cmp = (expr: string) => `${HEADER}
const ROW = "#.";
interface Line { text: string }
export default () => {
  const rows = ref<Line[]>([{ text: "#." }]);
  const x = ref(0);
  const n = ref(0);
  onButton((b) => {
    if (b === Button.A) x.value = 1;
    const t = rows.value[0];
    if (t && ${expr}) n.value = 1;
  });
  return (<><row y={0}>{n.value}</row></>);
};
`;

  test("lowers char === \"#\" to a C char-literal comparison, both orders", () => {
    const a = compileVaporApp("c.tsx", cmp("t.text[x.value] === \"#\""), "CMP", "gba");
    expect(a.c).toMatch(/vp_sb_at\(&l_t_\d+->text, g_x\) == '#'/);
    expect(a.c).not.toContain("== S");

    const b = compileVaporApp("c.tsx", cmp("\"#\" === t.text[x.value]"), "CMP", "gba");
    expect(b.c).toMatch(/'#' == vp_sb_at\(&l_t_\d+->text, g_x\)/);

    const ne = compileVaporApp("c.tsx", cmp("ROW[x.value] !== \"#\""), "CMP", "gba");
    expect(ne.c).toMatch(/vp_char_at\(S\d+, 2, g_x\) != '#'/);
  });

  test("strlit vs strlit keeps its existing pointer comparison", () => {
    const source = `${HEADER}
const A = "x";
const B = "y";
export default () => {
  const n = ref(0);
  onButton((b) => { if (A === B) n.value = 1; });
  return (<><row y={0}>{n.value}</row></>);
};
`;
    const app = compileVaporApp("c.tsx", source, "CMP", "gba");
    expect(app.c).toMatch(/\(S\d+ == S\d+\)/);
    expect(app.c).not.toContain("'x'");
  });

  for (const [expr] of [
    ["t.text[x.value] === \"##\""],
    ["\"##\" === ROW[x.value]"],
    ["ROW[x.value] !== \"##\""],
  ] as const) {
    test(`rejects a char compared to a multi-char literal: ${expr}`, () => {
      const msg = compileErr(cmp(expr));
      expect(msg).toContain("comparing a char to a multi-character string");
      expect(msg).toMatch(/^test\.tsx:\d+:\d+/);
    });
  }

  test("rejects a char compared to an empty string literal", () => {
    const msg = compileErr(cmp("t.text[x.value] === \"\""));
    expect(msg).toContain("comparing a char to an empty string");
  });

  test("escapes quote and backslash literals as char constants", () => {
    const quote = compileVaporApp("c.tsx", cmp("t.text[x.value] === \"'\""), "CMP", "gba");
    expect(quote.c).toMatch(/vp_sb_at\(&l_t_\d+->text, g_x\) == '\\''/);
    const slash = compileVaporApp("c.tsx", cmp("t.text[x.value] === \"\\\\\""), "CMP", "gba");
    expect(slash.c).toMatch(/vp_sb_at\(&l_t_\d+->text, g_x\) == '\\\\'/);
  });

  // the actual D207 fork: gba-gcc accepts the bad C, sdcc (GB) and cc65
  // (NES) reject it — build the small char-compare board through BOTH real
  // toolchains.
  const CHARBOARD = join(import.meta.dir, "fixtures", "charboard.tsx");
  const sdcc = Bun.which("sdcc");
  const cc65 = Bun.which("cc65");
  (sdcc ? test : test.skip)("gb: sdcc builds char-vs-char-literal comparisons", async () => {
    const { buildRom } = await import("../compiler/rom.ts");
    const dir = await mkdtemp(join(tmpdir(), "pocket-vapor-d207-gb-"));
    try {
      const source = await Bun.file(CHARBOARD).text();
      const app = compileVaporApp(CHARBOARD, source, "CHARBOARD", "gb");
      const rom = join(dir, "charboard.gb");
      const artifacts = await buildRom(app, "gb", rom);
      expect(artifacts[0].bytes).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  (cc65 ? test : test.skip)("nes: cc65 builds char-vs-char-literal comparisons", async () => {
    const { buildRom } = await import("../compiler/rom.ts");
    const dir = await mkdtemp(join(tmpdir(), "pocket-vapor-d207-nes-"));
    try {
      const source = await Bun.file(CHARBOARD).text();
      const app = compileVaporApp(CHARBOARD, source, "CHARBOARD", "nes");
      const rom = join(dir, "charboard.nes");
      const artifacts = await buildRom(app, "nes", rom);
      expect(artifacts[0].bytes).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// Dead data/functions: nm + grep showed no runtime reads (fleet task 822,
// scout task-764 §4.2). The cartridge title ships via JS-side header patches
// (rom.ts); GBA reads palette banks directly; the console runtimes never call
// app_on_axis_delta and reject axis registrations at compile time (VT102).
describe("dead data and dead functions are not emitted", () => {
  for (const target of ["gba", "gb", "nes", "esp32"] as const) {
    test(`${target}: generated C omits title and axis stub`, () => {
      const app = compileVaporApp(ENTRY, TODO_SOURCE, "VAPOR TODO", target);
      expect(app.c).not.toContain("vp_app_title");
      expect(app.c).not.toContain("app_on_axis_delta");
    });
  }

  test("gba omits vp_pal_style while gb/nes/playdate keep it", async () => {
    const gba = compileVaporApp(ENTRY, TODO_SOURCE, "VAPOR TODO", "gba");
    expect(gba.c).not.toContain("vp_pal_style");
    expect(gba.plan).toContain("203 B strings + 3040 B font + 194 B style data");
    for (const target of ["gb", "nes"] as const) {
      const app = compileVaporApp(ENTRY, TODO_SOURCE, "VAPOR TODO", target);
      expect(app.c).toContain("const u8 vp_pal_style[6]");
      expect(app.plan).toContain("187 B strings + 3040 B font + 6 B style data");
    }
    const playdateSix = await Bun.file(
      join(import.meta.dir, "..", "examples", "playdate-six-button", "playdate-six-button.tsx"),
    ).text();
    const playdate = compileVaporApp("six.tsx", playdateSix, "PLAYDATE SIX", "playdate");
    expect(playdate.c).toContain("const u8 vp_pal_style[3]");
    // playdate's runtime calls app_on_axis_delta unconditionally: the stub
    // stays even when the app registers no handler; the title still does not.
    expect(playdate.c).toContain("void app_on_axis_delta(u8 axis, s32 delta)");
    expect(playdate.c).not.toContain("vp_app_title");
  });

  const armGcc = Bun.which("arm-none-eabi-gcc");
  const armNm = Bun.which("arm-none-eabi-nm");
  (armGcc && armNm ? test : test.skip)("gba link keeps no dead symbols", async () => {
    const { buildGbaRom } = await import("../compiler/rom.ts");
    const dir = await mkdtemp(join(tmpdir(), "pocket-vapor-deadsym-"));
    try {
      const app = compileVaporApp(ENTRY, TODO_SOURCE, "VAPOR TODO", "gba");
      const rom = join(dir, "todo.gba");
      await buildGbaRom(app, rom);
      const elf = join(dir, "gen-gba", "app.elf");
      const out = await Bun.$`arm-none-eabi-nm ${elf}`.quiet().text();
      const names = out.trim().split("\n").map((line) => line.split(" ").slice(-1)[0]);
      expect(names).not.toContain("memset");
      expect(names).not.toContain("vp_app_title");
      expect(names).not.toContain("vp_pal_style");
      expect(names).not.toContain("app_on_axis_delta");
      // memcpy stays: struct assignment still lowers to it.
      expect(names).toContain("memcpy");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // sdcc does NOT dead-strip an unused static inline: it lands in gen_app.rel
  // and sdld keeps the whole object. Emitting vp_sb_at/vp_sb_put unconditionally
  // grew todo's GB _CODE by 184 B (9320 -> 9504, reviewer 1094 F1). The ROM
  // file stays 32768 B only because of 0xFF tail padding, so pin _CODE itself.
  const sdcc = Bun.which("sdcc");
  (sdcc ? test : test.skip)("gb _CODE does not grow from on-demand static inlines", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pocket-vapor-gbcode-"));
    try {
      const app = compileVaporApp(ENTRY, TODO_SOURCE, "VAPOR TODO", "gb");
      await buildRom(app, "gb", join(dir, "todo.gb"));
      const map = await Bun.file(join(dir, "gen-gb", "app.map")).text();
      const m = map.match(/_CODE\s+[0-9a-f]{8}\s+[0-9a-f]{8}\s+=\s+(\d+)\. bytes/);
      expect(m).not.toBeNull();
      expect(Number(m![1])).toBe(9320); // e1c1ce4 baseline; +184 if inlines are forced
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

const CAP_HEADER = `
import { computed, ref } from "vue";
import { Button, onButton } from "../../host/input.ts";
import { withCapacity } from "../../host/list.ts";
`;

// Two lists that used to share one global poolCap now size independently:
// a 12-record string-row board and a 64-deep undo stack must coexist on NES.
const CAP_SRC = `${CAP_HEADER}
interface Line { text: string }
interface Hist { d: boolean }
export default () => {
  const rows = ref<Line[]>(withCapacity([
    { text: "a" }, { text: "b" }, { text: "c" }, { text: "d" },
    { text: "e" }, { text: "f" }, { text: "g" }, { text: "h" },
    { text: "i" }, { text: "j" }, { text: "k" }, { text: "l" },
  ], 12));
  const hist = ref<Hist[]>(withCapacity([], 64));
  onButton((b) => { if (b === Button.A) hist.value.push({ d: false }); });
  return (<>
    {rows.value.map((r, i) => <row y={i}>{r.text}</row>)}
    <row y={13}>{hist.value.length}</row>
  </>);
};
`;

const CAP_VIEW_SRC = `${CAP_HEADER}
interface It { n: number }
export default () => {
  const items = ref<It[]>(withCapacity([{ n: 1 }, { n: 2 }], 12));
  const live = computed(() => items.value.filter((x) => x.n > 0));
  onButton((b) => {});
  return (<>{live.value.map((x, i) => <row y={i}>{x.n}</row>)}</>);
};
`;

describe("per-pool static capacity (withCapacity)", () => {
  test("each list gets its own declared C-array size and push guard", () => {
    const app = compileVaporApp("cap.tsx", CAP_SRC, "CAP", "nes");
    expect(app.c).toContain("g_rows[12]");
    expect(app.c).toContain("g_hist[64]");
    // the push guard compares against THIS pool's cap, not the global 8
    expect(app.c).toContain("if (g_hist_len < 64)");
    expect(app.c).not.toContain("if (g_hist_len < 8)");
    // no per-cap view typedef is emitted when no view needs one
    expect(app.c).not.toContain("vp_view12");
  });

  test("plan accounts for pools with distinct capacities", () => {
    // NES: Line is one vp_sb = strCap 20 + 1 = 21 B * 12 + 1 = 253;
    //      Hist is one bool = 1 B * 64 + 1 = 65.
    const nes = compileVaporApp("cap.tsx", CAP_SRC, "CAP", "nes");
    expect(nes.plan.split("\n")[0]).toContain("318 B pools");
    // GBA: Line is one vp_sb = 25 B (no s32 field -> no tail padding)
    //      * 12 + 1 = 301; Hist one bool = 1 * 64 + 1 = 65.
    const gba = compileVaporApp("cap.tsx", CAP_SRC, "CAP", "gba");
    expect(gba.plan.split("\n")[0]).toContain("366 B pools");
  });

  test("a view of a declared-cap list is sized to that list", () => {
    const nes = compileVaporApp("capview.tsx", CAP_VIEW_SRC, "CAPV", "nes");
    expect(nes.c).toContain("typedef struct { u8 len; u8 idx[12]; } vp_view12;");
    expect(nes.c).toContain("static vp_view12 c_live_v;");
    expect(nes.plan.split("\n")[0]).toContain("13 B computed views");
    // pool keeps the declared 12 even though the seed has 2
    expect(nes.c).toContain("g_items[12]");
  });

  test("an unannotated list keeps the target default (todo shape unchanged)", () => {
    const src = `${CAP_HEADER}
interface It { n: number }
export default () => {
  const items = ref<It[]>([{ n: 1 }]);
  onButton((b) => { if (b === Button.A) items.value.push({ n: 2 }); });
  return (<>{items.value.map((x, i) => <row y={i}>{x.n}</row>)}</>);
};
`;
    const nes = compileVaporApp("d.tsx", src, "D", "nes");
    expect(nes.c).toContain("g_items[8]");
    expect(nes.c).toContain("if (g_items_len < 8)");
    expect(nes.c).not.toMatch(/vp_view\d/);
    const gba = compileVaporApp("d.tsx", src, "D", "gba");
    expect(gba.c).toContain("g_items[32]");
  });

  test("rejects non-constant, non-positive, oversized, and seed-exceeding caps", () => {
    const wrap = (capArg: string) =>
      `${CAP_HEADER}
interface It { n: number }
export default () => {
  const k = ref(30);
  const items = ref<It[]>(withCapacity([], ${capArg}));
  onButton((b) => { if (b === Button.A) k.value = k.value + 1; });
  return (<>{items.value.map((x, i) => <row y={i}>{x.n}</row>)}</>);
};
`;
    // k is written in the handler, so SCCP cannot fold it: the cap is not
    // a compile-time integer and must be rejected.
    expect(compileErr(wrap("k.value"))).toContain("capacity must be a positive compile-time integer");
    expect(compileErr(wrap("0"))).toContain("capacity must be a positive compile-time integer");
    expect(compileErr(wrap("256"))).toContain("must fit in u8 (max 255)");
    expect(compileErr(wrap("6 - 10"))).toContain("capacity must be a positive compile-time integer");
    const seedTooBig = `${CAP_HEADER}
interface It { n: number }
export default () => {
  const items = ref<It[]>(withCapacity([{n:1},{n:2}], 1));
  onButton((b) => {});
  return (<>{items.value.map((x, i) => <row y={i}>{x.n}</row>)}</>);
};
`;
    expect(compileErr(seedTooBig)).toContain("capacity 1 is smaller than the 2-element seed");
  });

  test("rejects withCapacity on a non-list ref and a wrong argument count", () => {
    const onNum = `${CAP_HEADER}
export default () => {
  const n = ref(withCapacity(0, 4));
  onButton((b) => {});
  return (<row y={0}>{n.value}</row>);
};
`;
    expect(compileErr(onNum)).toContain("withCapacity only annotates list refs");
    const arity = `${CAP_HEADER}
interface It { n: number }
export default () => {
  const items = ref<It[]>(withCapacity([]));
  onButton((b) => {});
  return (<>{items.value.map((x, i) => <row y={i}>{x.n}</row>)}</>);
};
`;
    expect(compileErr(arity)).toContain("withCapacity takes exactly (seedArray, capacity)");
  });

  // The device half of the contract: the 12-row board + 64-deep undo stack
  // must fit NES RAM, the 65th push must trip VP_TRIP_POOL_FULL (never
  // overrun the array), and tripwires must stay clear through 64 pushes.
  const NES_RUNNER = join(import.meta.dir, "harness", "nes_runner.ts");
  const CAP_FIXTURE = join(import.meta.dir, "fixtures", "capacity.tsx");

  test("nes links a 12-row string board plus a 64-entry pool", async () => {
    const source = await Bun.file(CAP_FIXTURE).text();
    const app = compileVaporApp(CAP_FIXTURE, source, "CAP", "nes");
    expect(app.plan.split("\n")[0]).toContain("318 B pools");
    const dir = await mkdtemp(join(tmpdir(), "pocket-vapor-cap-"));
    try {
      const rom = join(dir, "cap.nes");
      await buildRom(app, "nes", rom); // throws on ld65 RAM overflow
      const bytes = (await Bun.file(rom).stat()).size;
      expect(bytes).toBe(40976);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60000);

  test("nes: 64 pushes keep tripwire clear, the 65th trips POOL_FULL", async () => {
    const source = await Bun.file(CAP_FIXTURE).text();
    const app = compileVaporApp(CAP_FIXTURE, source, "CAP", "nes");
    const dir = await mkdtemp(join(tmpdir(), "pocket-vapor-cap-run-"));
    try {
      const rom = join(dir, "cap.nes");
      await buildRom(app, "nes", rom);
      // vp_dbg_state starts at $0210 (after the 16-byte header). The two
      // refs are rows(listLen s32 @+0) then hist(listLen s32 @+4); trips
      // byte VP_TRIP_POOL_FULL lives at $020c.
      const STATE = 0x0210;
      const TRIPS = 0x020c;
      const lines = ["A 5"];
      const probe = (at: number) => [
        `D len${at} 0x${STATE.toString(16)} 8`,
        `R trips${at} 0x${TRIPS.toString(16)} 1`,
      ];
      lines.push(...probe(0));
      for (let i = 1; i <= 65; i++) {
        lines.push("P 1 2 8"); // Button.A
        lines.push(...probe(i));
      }
      const scenario = join(dir, "cap.txt");
      await Bun.write(scenario, lines.join("\n") + "\n");
      const out = await $`bun ${NES_RUNNER} ${rom} ${scenario}`.text();
      const parsed = JSON.parse(out) as { ok: boolean; reads: Record<string, string | number> };
      expect(parsed.ok).toBe(true);
      // debug bytes are dumped in address order; s32 len is little-endian,
      // hist len is the second 4 bytes (hex chars 8..15).
      const histLen = (at: number) => {
        const hex = parsed.reads[`len${at}`] as string;
        const b0 = parseInt(hex.slice(8, 10), 16);
        const b1 = parseInt(hex.slice(10, 12), 16);
        return b0 | (b1 << 8);
      };
      expect(histLen(64)).toBe(64);
      expect(parsed.reads["trips64"]).toBe(0);
      expect(histLen(65)).toBe(64); // guarded: length does not run past
      expect((parsed.reads["trips65"] as number) & 1).toBe(1); // VP_TRIP_POOL_FULL
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60000);
});

// Local const modules: `import { X } from "./levels.ts"` — the S2 hard
// dependency so sokoban.tsx / sokoban.playdate.tsx share level data and
// helpers without copy/paste (fleet tasks 966 §G8, 967 §3.3).
describe("local const module imports", () => {
  // A minimal legal local module: exported consts (number/string/string[]),
  // a closed interface, and subset helpers (number params, void — same rules
  // as in-file setup helpers until pure-returning helpers land).
  const LEVELS_TS = `
export const BW = 10;
export const GREETING = "SOKOBAN";
export const ROWS = ["####", "#@$.#", "####"];
export interface Cell { k: number; wall: boolean }
export function mark(d: number) { forStep(d); }
export function forStep(d: number) { if (d === 0) { return; } return; }
`;

  const APP_TSX = () => `
import { computed, ref } from "vue";
import { Button, onButton } from "${HOST_INPUT}";
import { BW, GREETING, ROWS, mark } from "./levels.ts";
export default () => {
  const count = ref(0);
  onButton((b) => {
    if (b === Button.A) mark(count.value);
    if (b === Button.B) count.value = GREETING.length;
  });
  return (
    <>
      <row y={0}>{ROWS[count.value]}</row>
      <row y={1}>{GREETING}{BW}{ROWS.length}</row>
    </>
  );
};
`;

  interface Proj { dir: string; entry: string }
  async function makeProject(files: Record<string, string>): Promise<Proj> {
    const dir = await mkdtemp(join(tmpdir(), "pocket-vapor-import-"));
    for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), content);
    return { dir, entry: join(dir, "app.tsx") };
  }

  async function compileProject(files: Record<string, string>, target: Parameters<typeof compileVaporApp>[3] = "gba") {
    const proj = await makeProject(files);
    try {
      return compileVaporApp(proj.entry, await Bun.file(proj.entry).text(), "IMPORT", target);
    } finally {
      // caller decides when to clean; kept for the test duration below
      await rm(proj.dir, { recursive: true, force: true });
    }
  }

  test("folds cross-file number/string/string[] consts and emits module helpers", async () => {
    const app = await compileProject({ "levels.ts": LEVELS_TS, "app.tsx": APP_TSX() });
    // number const folds to literal
    expect(app.c).toContain("vp_ln_int(10)");
    // string[].length folds across files
    expect(app.c).toContain("vp_ln_int(3)");
    // helpers from the imported module compile to real C functions with a
    // module-prefixed name, and call each other
    expect(app.c).toContain("static void fn_m0_mark(s32 p_d)");
    expect(app.c).toContain("static void fn_m0_forStep(s32 p_d)");
    expect(app.c).toContain("fn_m0_forStep(p_d);");
    expect(app.c).toContain("fn_m0_mark(g_count)");
    // string[] const folds to a ROM pointer table named after the module const
    expect(app.c).toMatch(/static const char \*const A_m0_ROWS\[3\]/);
    // the imported string itself is in ROM
    expect(app.c).toContain('static const char S0[] = "SOKOBAN";');
    // the imported closed interface becomes a module-qualified record
    // typedef: interfaces live in their own module's namespace, so two
    // modules may export same-named shapes without colliding.
    expect(app.c).toContain("typedef struct { s32 k; u8 wall; } rec_m0_cell;");
  });

  test("per-target SCREEN-style folds still resolve across modules", async () => {
    // BW is used identically regardless of target; smoke-check gb + nes parse
    const gb = await compileProject({ "levels.ts": LEVELS_TS, "app.tsx": APP_TSX() }, "gb");
    const nes = await compileProject({ "levels.ts": LEVELS_TS, "app.tsx": APP_TSX() }, "nes");
    expect(gb.c).toContain("/* target: gb (20x18) */");
    expect(nes.c).toContain("/* target: nes (22x18) */");
  });

  test("rejects a module containing a ref", async () => {
    const bad = `
import { ref } from "vue";
export const n = ref(0);
`;
    let msg = "";
    const proj = await makeProject({ "levels.ts": bad, "app.tsx": APP_TSX() });
    try {
      try {
        compileVaporApp(proj.entry, await Bun.file(proj.entry).text());
      } catch (e) {
        expect(e).toBeInstanceOf(VaporCompileError);
        msg = (e as Error).message;
      }
      expect(msg).toMatch(/levels\.ts:\d+:\d+/);
      expect(msg).toContain("vue");
    } finally {
      await rm(proj.dir, { recursive: true, force: true });
    }
  });

  test("rejects a module with side effects", async () => {
    const bad = `
export const BW = 10;
BW + 1;
`;
    let msg = "";
    const proj = await makeProject({ "levels.ts": bad, "app.tsx": APP_TSX() });
    try {
      try {
        compileVaporApp(proj.entry, await Bun.file(proj.entry).text());
      } catch (e) {
        expect(e).toBeInstanceOf(VaporCompileError);
        msg = (e as Error).message;
      }
      expect(msg).toMatch(/levels\.ts:\d+:\d+/);
      expect(msg).toMatch(/may only contain export const/);
    } finally {
      await rm(proj.dir, { recursive: true, force: true });
    }
  });

  test("rejects circular imports", async () => {
    const a = `export const A = 1;`;
    // b imports c and c imports b — cycle
    const b = `import { C } from "./c.ts";\nexport const B = C;`;
    const c = `import { B } from "./b.ts";\nexport const C = B + 1;`;
    const app = `
import { computed, ref } from "vue";
import { Button, onButton } from "${HOST_INPUT}";
import { B } from "./b.ts";
export default () => {
  const count = ref(0);
  onButton((bb) => { if (bb === Button.A) count.value = B; });
  return (<><row y={0}>{count.value}</row></>);
};
`;
    let msg = "";
    const proj = await makeProject({ "a.ts": a, "b.ts": b, "c.ts": c, "app.tsx": app });
    try {
      try {
        compileVaporApp(proj.entry, await Bun.file(proj.entry).text());
      } catch (e) {
        expect(e).toBeInstanceOf(VaporCompileError);
        msg = (e as Error).message;
      }
      expect(msg).toMatch(/circular import/);
    } finally {
      await rm(proj.dir, { recursive: true, force: true });
    }
  });

  test("rejects non-relative import sources", async () => {
    const app = `
import { computed, ref } from "vue";
import { Button, onButton } from "${HOST_INPUT}";
import { levels } from "levels";
export default () => {
  const count = ref(0);
  onButton((b) => {});
  return (<><row y={0}>{count.value}</row></>);
};
`;
    const msg = (() => {
      try {
        compileVaporApp("app.tsx", app);
      } catch (e) {
        return (e as Error).message;
      }
      throw new Error("expected error");
    })();
    expect(msg).toMatch(/local imports must use a relative path/);
  });

  test("resolves extensionless relative imports to .ts", async () => {
    const app = `
import { computed, ref } from "vue";
import { Button, onButton } from "${HOST_INPUT}";
import { BW } from "./levels";
export default () => {
  const count = ref(0);
  onButton((b) => {});
  return (<><row y={0}>{count.value}{BW}</row></>);
};
`;
    const compiled = await compileProject({ "levels.ts": LEVELS_TS, "app.tsx": app });
    expect(compiled.c).toContain("vp_ln_int(10)");
  });

  test("rejects a local module that is not a .ts/.tsx file", async () => {
    const app = `
import { computed, ref } from "vue";
import { Button, onButton } from "${HOST_INPUT}";
import { BW } from "./data.txt";
export default () => {
  const count = ref(0);
  onButton((b) => {});
  return (<><row y={0}>{count.value}</row></>);
};
`;
    let msg = "";
    const proj = await makeProject({ "data.txt": "export const BW = 10;", "app.tsx": app });
    try {
      try {
        compileVaporApp(proj.entry, await Bun.file(proj.entry).text());
      } catch (e) {
        expect(e).toBeInstanceOf(VaporCompileError);
        msg = (e as Error).message;
      }
      expect(msg).toMatch(/must be a \.ts file/);
    } finally {
      await rm(proj.dir, { recursive: true, force: true });
    }
  });

  test("rejects a module helper that returns a value", async () => {
    const bad = `
export const BW = 10;
export function add(a: number, b: number): number { return a + b + BW; }
`;
    let msg = "";
    const proj = await makeProject({ "levels.ts": bad, "app.tsx": APP_TSX() });
    try {
      try {
        compileVaporApp(proj.entry, await Bun.file(proj.entry).text());
      } catch (e) {
        expect(e).toBeInstanceOf(VaporCompileError);
        msg = (e as Error).message;
      }
      expect(msg).toMatch(/levels\.ts:\d+:\d+.*cannot return values/);
    } finally {
      await rm(proj.dir, { recursive: true, force: true });
    }
  });

  test("rejects a module that imports vue", async () => {
    const bad = `import { ref } from "vue";\nexport const n = 1;\n`;
    let msg = "";
    const proj = await makeProject({ "levels.ts": bad, "app.tsx": APP_TSX() });
    try {
      try {
        compileVaporApp(proj.entry, await Bun.file(proj.entry).text());
      } catch (e) {
        expect(e).toBeInstanceOf(VaporCompileError);
        msg = (e as Error).message;
      }
      expect(msg).toMatch(/levels\.ts:1:\d+/);
      expect(msg).toContain("vue");
    } finally {
      await rm(proj.dir, { recursive: true, force: true });
    }
  });

  test("follows a chain of local module imports", async () => {
    const base = `export const BASE = 100;\nexport function bump(d: number) { if (d === BASE) { return; } }`;
    const mid = `
import { BASE, bump } from "./base.ts";
export const MID = BASE + 1;
export function go(d: number) { bump(d + MID); }
`;
    const app = `
import { computed, ref } from "vue";
import { Button, onButton } from "${HOST_INPUT}";
import { MID, go } from "./mid.ts";
export default () => {
  const count = ref(0);
  onButton((b) => { if (b === Button.A) go(count.value); });
  return (<><row y={0}>{MID}</row></>);
};
`;
    const compiled = await compileProject({ "base.ts": base, "mid.ts": mid, "app.tsx": app });
    expect(compiled.c).toContain("vp_ln_int(101)");
    // mid is loaded first (idx 0), its transitive base second (idx 1); the
    // helper from mid is emitted and calls through into base's helper
    expect(compiled.c).toContain("static void fn_m0_go(s32 p_d)");
    expect(compiled.c).toContain("fn_m1_bump(");
  });

  test("rejects importing a name the module does not export", async () => {
    const app = APP_TUX_MISSING();
    let msg = "";
    const proj = await makeProject({ "levels.ts": LEVELS_TS, "app.tsx": app });
    try {
      try {
        compileVaporApp(proj.entry, await Bun.file(proj.entry).text());
      } catch (e) {
        expect(e).toBeInstanceOf(VaporCompileError);
        msg = (e as Error).message;
      }
      expect(msg).toMatch(/does not export/);
    } finally {
      await rm(proj.dir, { recursive: true, force: true });
    }
  });

  test("diagnostics carry imported file line:col", async () => {
    const bad = `export const N = 1;\nsideEffect();\n`;
    const proj = await makeProject({
      "levels.ts": bad,
      "app.tsx": `
import { computed, ref } from "vue";
import { Button, onButton } from "${HOST_INPUT}";
import { N } from "./levels.ts";
export default () => {
  const count = ref(N);
  onButton((b) => {});
  return (<><row y={0}>{count.value}</row></>);
};
`,
    });
    let msg = "";
    try {
      try {
        compileVaporApp(proj.entry, await Bun.file(proj.entry).text());
      } catch (e) {
        expect(e).toBeInstanceOf(VaporCompileError);
        msg = (e as Error).message;
      }
      expect(msg).toMatch(/levels\.ts:2:\d+/);
    } finally {
      await rm(proj.dir, { recursive: true, force: true });
    }
  });

  // ---- imported interfaces are module-scoped (review task 1024 B1) --------

  test("same-named interfaces in two modules keep their own shape", async () => {
    // a.ts exports Cell{x}; merely loading b.ts (which exports its own
    // Cell{y}) must not overwrite the shape the app imported from a.ts.
    const a = `export interface Cell { x: number }\nexport const A = 1;`;
    const b = `export interface Cell { y: number }\nexport const B = 2;`;
    const app = `
import { computed, ref } from "vue";
import { Button, onButton } from "${HOST_INPUT}";
import { Cell, A } from "./a.ts";
import { B } from "./b.ts";
export default () => {
  const cells = ref<Cell[]>([{ x: A + B }]);
  onButton((b) => {});
  return (<>{cells.value.map((cell, i) => <row y={i}>{cell.x}</row>)}</>);
};
`;
    const compiled = await compileProject({ "a.ts": a, "b.ts": b, "app.tsx": app });
    // a.ts loads first (m0); its record keeps field x, even though b.ts (m1)
    // registered a same-named Cell with field y.
    expect(compiled.c).toContain("typedef struct { s32 x; } rec_m0_cell;");
    expect(compiled.c).toContain("rec_m0_cell *");
    expect(compiled.c).not.toContain("rec_m0_cell y");
  });

  test("a module helper resolves a same-module imported-interface record field", async () => {
    // The component owns the Cell[] pool (Cell from m0); a helper exported
    // by the same module mutates it and must resolve field x through the
    // module's interface, not a global bare-name table.
    const mod = `
export interface Cell { x: number }
export function bump(cells: number) { return; }
`;
    const app = `
import { computed, ref } from "vue";
import { Button, onButton } from "${HOST_INPUT}";
import { Cell } from "./mod.ts";
export default () => {
  const cells = ref<Cell[]>([{ x: 1 }]);
  onButton((b) => {});
  return (<>{cells.value.map((cell, i) => <row y={i}>{cell.x}</row>)}</>);
};
`;
    const compiled = await compileProject({ "mod.ts": mod, "app.tsx": app });
    expect(compiled.c).toContain("typedef struct { s32 x; } rec_m0_cell;");
  });

  test("accepts an aliased imported interface (Cell as Tile)", async () => {
    const mod = `export interface Cell { k: number; wall: boolean }\nexport const X = 1;`;
    const app = `
import { computed, ref } from "vue";
import { Button, onButton } from "${HOST_INPUT}";
import { Cell as Tile, X } from "./mod.ts";
export default () => {
  const cells = ref<Tile[]>([{ k: X, wall: false }]);
  onButton((b) => {});
  return (<>{cells.value.map((cell, i) => <row y={i}>{cell.k}</row>)}</>);
};
`;
    const compiled = await compileProject({ "mod.ts": mod, "app.tsx": app });
    expect(compiled.c).toContain("typedef struct { s32 k; u8 wall; } rec_m0_cell;");
  });

  test("rejects interface heritage (extends) with a located diagnostic", async () => {
    const mod = `export interface Base { x: number }\nexport interface Cell extends Base { y: number }\nexport const X = 1;`;
    const app = `
import { computed, ref } from "vue";
import { Button, onButton } from "${HOST_INPUT}";
import { Cell, X } from "./mod.ts";
export default () => {
  const cells = ref<Cell[]>([{ x: X, y: 2 }]);
  onButton((b) => {});
  return (<>{cells.value.map((cell, i) => <row y={i}>{cell.y}</row>)}</>);
};
`;
    let msg = "";
    const proj = await makeProject({ "mod.ts": mod, "app.tsx": app });
    try {
      try {
        compileVaporApp(proj.entry, await Bun.file(proj.entry).text());
      } catch (e) {
        expect(e).toBeInstanceOf(VaporCompileError);
        msg = (e as Error).message;
      }
      // heritage clause ("extends") is on line 2 col 23
      expect(msg).toMatch(/mod\.ts:2:23 — .*(heritage|extends|inherit)/);
    } finally {
      await rm(proj.dir, { recursive: true, force: true });
    }
  });

  test("rejects binding the same local interface name from two modules", async () => {
    const a = `export interface Cell { x: number }`;
    const b = `export interface Cell { y: number }`;
    const app = `
import { computed, ref } from "vue";
import { Button, onButton } from "${HOST_INPUT}";
import { Cell } from "./a.ts";
import { Cell } from "./b.ts";
export default () => {
  const cells = ref<Cell[]>([{ x: 1 }]);
  onButton((b) => {});
  return (<>{cells.value.map((cell, i) => <row y={i}>{cell.x}</row>)}</>);
};
`;
    let msg = "";
    const proj = await makeProject({ "a.ts": a, "b.ts": b, "app.tsx": app });
    try {
      try {
        compileVaporApp(proj.entry, await Bun.file(proj.entry).text());
      } catch (e) {
        expect(e).toBeInstanceOf(VaporCompileError);
        msg = (e as Error).message;
      }
      expect(msg).toMatch(/app\.tsx:5:\d+ — .*(already|duplicate|conflict)/i);
    } finally {
      await rm(proj.dir, { recursive: true, force: true });
    }
  });

  // ---- recursive helpers are rejected (review task 1024 B2) --------------

  const recApp = (imp: string) => `
import { computed, ref } from "vue";
import { Button, onButton } from "${HOST_INPUT}";
${imp}
export default () => {
  const n = ref(0);
  onButton((b) => {});
  return (<><row y={0}>{n.value}</row></>);
};
`;

  test("rejects a directly recursive module helper with file:line:col", async () => {
    // call to go(n - 1) is on line 1 col 40
    const mod = `export function go(n: number) { if (n > 0) go(n - 1); }\n`;
    let msg = "";
    const proj = await makeProject({ "mod.ts": mod, "app.tsx": recApp('import { go } from "./mod.ts";') });
    try {
      try {
        compileVaporApp(proj.entry, await Bun.file(proj.entry).text());
      } catch (e) {
        expect(e).toBeInstanceOf(VaporCompileError);
        msg = (e as Error).message;
      }
      expect(msg).toMatch(/mod\.ts:1:44 — .*recursi/i);
    } finally {
      await rm(proj.dir, { recursive: true, force: true });
    }
  });

  test("rejects a directly recursive module helper that is never called", async () => {
    // static analysis must reject the declaration cycle even when the app
    // never invokes the helper (no reachability escape hatch).
    const mod = `export function loop(n: number) { if (n > 0) loop(n - 1); }\n`;
    let msg = "";
    const proj = await makeProject({ "mod.ts": mod, "app.tsx": recApp('import { loop } from "./mod.ts";') });
    try {
      try {
        compileVaporApp(proj.entry, await Bun.file(proj.entry).text());
      } catch (e) {
        expect(e).toBeInstanceOf(VaporCompileError);
        msg = (e as Error).message;
      }
      expect(msg).toMatch(/mod\.ts:1:\d+ .*recursi/i);
    } finally {
      await rm(proj.dir, { recursive: true, force: true });
    }
  });

  test("rejects a parenthesized recursive module helper call", async () => {
    // review task 1155 R1: the static call graph must unparen the callee,
    // or `(go)(n - 1)` hides the self-edge while the generator emits a real
    // recursive C call (unsupported: no C stack budget).
    for (const call of ["(go)(n - 1)", "((go))((n - 1))"]) {
      const mod = `export function go(n: number) { if (n > 0) ${call}; }\n`;
      let msg = "";
      const proj = await makeProject({ "mod.ts": mod, "app.tsx": recApp('import { go } from "./mod.ts";') });
      try {
        try {
          compileVaporApp(proj.entry, await Bun.file(proj.entry).text());
        } catch (e) {
          expect(e).toBeInstanceOf(VaporCompileError);
          msg = (e as Error).message;
        }
        expect(msg, call).toMatch(/mod\.ts:1:\d+ .*recursi/i);
      } finally {
        await rm(proj.dir, { recursive: true, force: true });
      }
    }
  });

  test("rejects mutually recursive helpers inside one module", async () => {
    const mod =
      "export function a(n: number) { if (n > 0) b(n - 1); }\n" +
      "export function b(n: number) { if (n > 0) a(n - 1); }\n";
    let msg = "";
    const proj = await makeProject({ "mod.ts": mod, "app.tsx": recApp('import { a } from "./mod.ts";') });
    try {
      try {
        compileVaporApp(proj.entry, await Bun.file(proj.entry).text());
      } catch (e) {
        expect(e).toBeInstanceOf(VaporCompileError);
        msg = (e as Error).message;
      }
      expect(msg).toMatch(/mod\.ts:[12]:\d+ .*recursi/i);
    } finally {
      await rm(proj.dir, { recursive: true, force: true });
    }
  });

  test("rejects a directly recursive in-file setup helper", async () => {
    const app = `
import { computed, ref } from "vue";
import { Button, onButton } from "${HOST_INPUT}";
export default () => {
  const n = ref(0);
  function go(n: number) { if (n > 0) go(n - 1); }
  onButton((b) => { if (b === Button.A) go(1); });
  return (<><row y={0}>{n.value}</row></>);
};
`;
    let msg = "";
    const proj = await makeProject({ "app.tsx": app });
    try {
      try {
        compileVaporApp(proj.entry, await Bun.file(proj.entry).text());
      } catch (e) {
        expect(e).toBeInstanceOf(VaporCompileError);
        msg = (e as Error).message;
      }
      expect(msg).toMatch(/app\.tsx:6:39 — .*recursi/i);
    } finally {
      await rm(proj.dir, { recursive: true, force: true });
    }
  });

  test("rejects a parenthesized recursive in-file void setup helper", async () => {
    // same unparen requirement on the setup-helper side of the static graph
    const app = `
import { computed, ref } from "vue";
import { Button, onButton } from "${HOST_INPUT}";
export default () => {
  const n = ref(0);
  function go(n: number) { if (n > 0) (go)(n - 1); }
  onButton((b) => { if (b === Button.A) go(1); });
  return (<><row y={0}>{n.value}</row></>);
};
`;
    let msg = "";
    const proj = await makeProject({ "app.tsx": app });
    try {
      try {
        compileVaporApp(proj.entry, await Bun.file(proj.entry).text());
      } catch (e) {
        expect(e).toBeInstanceOf(VaporCompileError);
        msg = (e as Error).message;
      }
      expect(msg).toMatch(/app\.tsx:6:\d+ — .*recursi/i);
    } finally {
      await rm(proj.dir, { recursive: true, force: true });
    }
  });

  test("rejects mutually recursive in-file setup helpers", async () => {
    const app = `
import { computed, ref } from "vue";
import { Button, onButton } from "${HOST_INPUT}";
export default () => {
  const n = ref(0);
  function a(x: number) { if (x > 0) { b(x - 1); } }
  function b(x: number) { if (x > 0) { a(x - 1); } }
  onButton((bb) => { if (bb === Button.A) a(1); });
  return (<><row y={0}>{n.value}</row></>);
};
`;
    let msg = "";
    const proj = await makeProject({ "app.tsx": app });
    try {
      try {
        compileVaporApp(proj.entry, await Bun.file(proj.entry).text());
      } catch (e) {
        expect(e).toBeInstanceOf(VaporCompileError);
        msg = (e as Error).message;
      }
      expect(msg).toMatch(/app\.tsx:[67]:40 — .*recursi/i);
    } finally {
      await rm(proj.dir, { recursive: true, force: true });
    }
  });
});

function APP_TUX_MISSING(): string {
  return `
import { ref } from "vue";
import { Button, onButton } from "${HOST_INPUT}";
import { nope } from "./levels.ts";
export default () => {
  const count = ref(0);
  onButton((b) => { if (b === Button.A) count.value = nope; });
  return (<><row y={0}>{count.value}</row></>);
};
`;
}
