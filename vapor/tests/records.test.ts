// vapor/tests/records.test.ts — record field layout: descending alignment on
// padding ABIs (gba/esp32/playdate gcc/clang), source order on the byte-tight
// sdcc/cc65 targets; memory plan must report the linker's actual stride.

import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { compileVaporApp } from "../compiler/compile.ts";
import { buildRom } from "../compiler/rom.ts";

const HEADER = `
import { computed, ref } from "vue";
import { Button, onButton } from "../../host/input.ts";
`;

const MIXED = `${HEADER}
interface It { a: string; n: number; ok: boolean; q: number; b: string }
export default () => {
  const items = ref<It[]>([]);
  onButton((b) => {});
  return (<><row y={0}>{items.value.length}</row></>);
};
`;

function structOf(c: string): string {
  return c.match(/typedef struct \{[^}]*\} rec_\w+;/)![0];
}

describe("record field ordering by target ABI", () => {
  test("padding ABIs (gba/esp32/playdate) place s32 fields first, narrow fields stable", () => {
    // raw field order is str, num, bool, num, str: the two s32 fields move to
    // the front in source order (n before q), the align-1 fields keep theirs
    // (a before ok before b).
    const sorted = "typedef struct { s32 n; s32 q; vp_sb a; u8 ok; vp_sb b; } rec_it;";
    for (const target of ["gba", "esp32", "playdate"] as const) {
      const app = compileVaporApp("it.tsx", MIXED, "MIXED", target);
      expect(structOf(app.c)).toBe(sorted);
    }
  });

  test("sdcc/cc65 (gb/nes) keep interface source order", () => {
    const source = "typedef struct { vp_sb a; s32 n; u8 ok; s32 q; vp_sb b; } rec_it;";
    for (const target of ["gb", "nes"] as const) {
      const app = compileVaporApp("it.tsx", MIXED, "MIXED", target);
      expect(structOf(app.c)).toBe(source);
    }
  });

  test("records without s32 fields keep source order on every target", () => {
    const src = `${HEADER}
interface S { text: string; done: boolean }
export default () => {
  const items = ref<S[]>([]);
  onButton((b) => {});
  return (<><row y={0}>{items.value.length}</row></>);
};
`;
    for (const target of ["gba", "esp32", "playdate", "gb", "nes"] as const) {
      const app = compileVaporApp("s.tsx", src, "S", target);
      expect(structOf(app.c)).toBe("typedef struct { vp_sb text; u8 done; } rec_s;");
    }
  });

  test("number-only records keep source order", () => {
    const src = `${HEADER}
interface N { x: number; y: number }
export default () => {
  const items = ref<N[]>([]);
  onButton((b) => {});
  return (<><row y={0}>{items.value.length}</row></>);
};
`;
    const app = compileVaporApp("n.tsx", src, "N", "gba");
    expect(structOf(app.c)).toBe("typedef struct { s32 x; s32 y; } rec_n;");
  });
});

describe("memory plan matches the C ABI record stride", () => {
  test("mixed record is padded to 4 bytes only on gba/esp32/playdate", () => {
    // gba/esp32/playdate/gb strCap 24: raw 25+4+1+4+25 = 59 bytes, padded
    // ABIs round to 60; nes strCap 20: raw 21+4+1+4+21 = 51, cc65 packs tight.
    const planOf = (target: any) =>
      compileVaporApp("it.tsx", MIXED, "MIXED", target).plan.split("\n")[0];
    expect(planOf("gba")).toContain("1921 B pools"); // 60 * 32 + 1 len
    expect(planOf("esp32")).toContain("1921 B pools");
    expect(planOf("playdate")).toContain("1921 B pools");
    expect(planOf("gb")).toContain("1889 B pools"); // 59 * 32 + 1
    expect(planOf("nes")).toContain("409 B pools"); // 51 * 8 + 1
  });

  test("a raw size already divisible by 4 needs no padding", () => {
    const src = `${HEADER}
interface N { x: number; y: number }
export default () => {
  const items = ref<N[]>([]);
  onButton((b) => {});
  return (<><row y={0}>{items.value.length}</row></>);
};
`;
    // 8 bytes/record, no tail pad: 8 * 32 + 1
    expect(compileVaporApp("n.tsx", src, "N", "gba").plan.split("\n")[0]).toContain("257 B pools");
  });
});

// A mixed record actually exercised on ARM: boot renders the s32 + string +
// bool fields, a button rewrites the s32 field, toggles the bool, and pushes
// a second record — field offsets the compiler emitted must be the ones the
// ABI laid out.
const FUNC = `${HEADER}
interface Item {
  text: string;
  pri: number;
  done: boolean;
}
export default () => {
  const items = ref<Item[]>([{ text: "A", pri: 1000, done: false }]);
  onButton((b) => {
    if (b === Button.A) {
      const t = items.value[0];
      if (t) {
        t.pri = t.pri + 256;
        t.done = !t.done;
      }
      items.value.push({ text: "BB", pri: 2, done: true });
    }
  });
  return (<>{items.value.map((it, i) => <row y={i}>[{it.done ? 1 : 0}]{it.text}:{it.pri}</row>)}</>);
};
`;

describe("mixed record on GBA hardware", () => {
  const MGBA_RUNNER = join(import.meta.dir, "harness", "mgba_runner");

  beforeAll(async () => {
    if (!existsSync(MGBA_RUNNER)) await $`bun ${join(import.meta.dir, "harness", "build.ts")}`.quiet();
  });

  test("fields read and write at their ABI offsets after reordering", async () => {
    const app = compileVaporApp("func.tsx", FUNC, "FUNC", "gba");
    expect(structOf(app.c)).toBe("typedef struct { s32 pri; vp_sb text; u8 done; } rec_item;");
    // 32-byte stride * 32 slots + 1: the plan must match the ELF allocation.
    expect(app.plan.split("\n")[0]).toContain("1025 B pools");

    const dir = await mkdtemp(join(tmpdir(), "pocket-vapor-records-"));
    try {
      const rom = join(dir, "rec.gba");
      await buildRom(app, "gba", rom);
      const scenario = join(dir, "scenario.txt");
      await Bun.write(
        scenario,
        ["A 5", "D grid0 0x2000100 60", "P 1 2 4", "D grid1 0x2000100 60", "R trips 0x200000c 1"].join("\n") + "\n",
      );
      const out = await $`${MGBA_RUNNER} ${rom} ${scenario}`.text();
      const parsed = JSON.parse(out) as {
        ok: boolean;
        reads: Record<string, string | number>;
      };
      expect(parsed.ok).toBe(true);
      const row = (hex: string, y: number) =>
        Buffer.from(hex.slice(y * 60, y * 60 + 30), "hex").toString("latin1").trimEnd();
      expect(row(parsed.reads.grid0 as string, 0)).toBe("[0]A:1000");
      expect(row(parsed.reads.grid1 as string, 0)).toBe("[1]A:1256");
      expect(row(parsed.reads.grid1 as string, 1)).toBe("[1]BB:2");
      expect(parsed.reads.trips).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60000);
});
