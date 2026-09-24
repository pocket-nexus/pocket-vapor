// vapor/tests/guard-read-parity.test.ts — Review task 1161 R2 regression.
//
// A dynamic record-string read guarded only by `x < line.text.length`
// diverges at x = -1: the device's vp_sb_at returns the space sentinel while
// real Vue interpolates undefined as nothing. The documented two-sided guard
// (`x >= 0 && x < line.text.length`) keeps oracle and device identical at
// the negative bound, in range, and past the upper bound, on all three
// consoles, with no tripwire.

import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { compileVaporApp, VAPOR_TARGETS, type VaporTargetName } from "../compiler/compile.ts";
import { buildRom } from "../compiler/rom.ts";
import { bootOracle } from "../oracle/boot.ts";
import { Button } from "../host/input.ts";

const HERE = import.meta.dir;
const SRC = join(HERE, "fixtures", "guard-read.tsx");
const ENTRY = join(HERE, "fixtures", "guard-read-entry.ts");
const MGBA_RUNNER = join(HERE, "harness", "mgba_runner");
const NES_RUNNER = join(HERE, "harness", "nes_runner.ts");

// x: 0 -> -1 (Left) -> 0 -> 1 (Right x2) -> 3 (Down) -> 4 (Right)
const TAPE = [Button.Left, Button.Right, Button.Right, Button.Down, Button.Right] as const;
const EXPECTED_CELL = ["[A]", "[?]", "[A]", "[B]", "[?]", "[?]"];
const EXPECTED_X = ["0", "-1", "0", "1", "3", "4"];

interface Rig {
  name: VaporTargetName;
  charsAddr: number;
  tripsAddr: number;
  boot: string;
  press: (mask: number) => string;
  run: (rom: string, scenario: string) => Promise<string>;
}

const RIGS: Rig[] = [
  {
    name: "gba",
    charsAddr: 0x2000100,
    tripsAddr: 0x200000c,
    boot: "A 5",
    press: (mask) => `P ${mask.toString(16)} 2 4`,
    run: async (rom, scenario) => await $`${MGBA_RUNNER} ${rom} ${scenario}`.text(),
  },
  {
    name: "gb",
    charsAddr: 0xd840,
    tripsAddr: 0xd80c,
    boot: "A 90",
    press: (mask) => `P ${mask.toString(16)} 16 40`,
    run: async (rom, scenario) => await $`${MGBA_RUNNER} ${rom} ${scenario}`.text(),
  },
  {
    name: "nes",
    charsAddr: 0x0240,
    tripsAddr: 0x020c,
    boot: "A 5",
    press: (mask) => `P ${mask.toString(16)} 2 8`,
    run: async (rom, scenario) => $`bun ${NES_RUNNER} ${rom} ${scenario}`.text(),
  },
];

interface DeviceRun {
  cell: string[];
  x: string[];
  trips: number;
}

async function runDevice(rig: Rig, source: string, dir: string): Promise<DeviceRun> {
  const t = VAPOR_TARGETS[rig.name];
  const cells = t.width * t.height;
  const app = compileVaporApp(SRC, source, "GUARDREAD", rig.name);
  const rom = join(dir, `guard-read.${rig.name}`);
  await buildRom(app, rig.name, rom);

  const lines: string[] = [rig.boot];
  const probe = (i: number) => `D chars${i} 0x${rig.charsAddr.toString(16)} ${cells}`;
  lines.push(probe(0));
  TAPE.forEach((b, i) => {
    lines.push(rig.press(1 << b));
    lines.push(probe(i + 1));
  });
  lines.push(`R trips 0x${rig.tripsAddr.toString(16)} 1`);
  const scenario = join(dir, `scenario-${rig.name}.txt`);
  await Bun.write(scenario, lines.join("\n") + "\n");

  const out = await rig.run(rom, scenario);
  const parsed = JSON.parse(out) as { ok: boolean; reads: Record<string, string | number> };
  expect(parsed.ok).toBe(true);
  const read = (i: number, y: number, n: number): string => {
    const hex = parsed.reads[`chars${i}`] as string;
    let s = "";
    for (let xx = 0; xx < n; xx++) {
      const at = (y * t.width + xx) * 2;
      s += String.fromCharCode(parseInt(hex.slice(at, at + 2), 16) || 32);
    }
    return s.trimEnd();
  };
  return {
    cell: Array.from({ length: TAPE.length + 1 }, (_, i) => read(i, 0, 4)),
    x: Array.from({ length: TAPE.length + 1 }, (_, i) => read(i, 2, 4)),
    trips: parsed.reads.trips as number,
  };
}

const runs = new Map<VaporTargetName, DeviceRun>();
let source = "";
let styles: ReturnType<typeof compileVaporApp>["styles"];

beforeAll(async () => {
  if (!existsSync(MGBA_RUNNER)) await $`bun ${join(HERE, "harness", "build.ts")}`.quiet();
  source = await Bun.file(SRC).text();
  styles = compileVaporApp(SRC, source, "GUARDREAD", "gba").styles;
  const dir = await mkdtemp(join(tmpdir(), "vapor-guardread-"));
  try {
    for (const rig of RIGS) runs.set(rig.name, await runDevice(rig, source, dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 300000);

describe("1161 R2: the two-sided string-index guard matches the oracle at both bounds", () => {
  for (const rig of RIGS) {
    test(`${rig.name}: every frame matches the oracle through x = -1, in range, and past the end`, async () => {
      const dev = runs.get(rig.name)!;
      const o = await bootOracle({
        width: VAPOR_TARGETS[rig.name].width,
        height: VAPOR_TARGETS[rig.name].height,
        styles,
        entry: ENTRY,
      });
      const snapshot = () => ({
        cell: o.grid().chars[0].slice(0, 4).trimEnd(),
        x: o.grid().chars[2].slice(0, 4).trimEnd(),
      });
      const want = [snapshot()];
      for (const b of TAPE) {
        await o.press(b);
        want.push(snapshot());
      }
      o.unmount();
      for (let i = 0; i < want.length; i++) {
        expect(dev.cell[i], `step ${i} cell`).toBe(want[i].cell);
        expect(dev.x[i], `step ${i} x`).toBe(want[i].x);
      }
      // pins the exact guard behaviour: [-1..4] cells and x values
      expect(dev.cell).toEqual(EXPECTED_CELL);
      expect(dev.x).toEqual(EXPECTED_X);
      expect(dev.trips).toBe(0);
    });
  }
});
