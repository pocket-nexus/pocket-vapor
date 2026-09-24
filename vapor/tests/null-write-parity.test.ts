// vapor/tests/null-write-parity.test.ts — Reviewer 1094 F3 regression.
// A write through a record pointer that is null because the pool index was
// out of range used to dereference address ~0 on device: the GBA hung
// permanently after the first such press. Real Vue throws a TypeError, so
// the device contract is a safe trip instead: skip the write, set
// VP_TRIP_NULL, and keep serving frames (the counter keeps counting).
//
// Tape: A (string-field putChar through null), Right (liveness), B
// (number-field write through null), Right (liveness). Both null writes
// trip VP_TRIP_NULL (bit 5, value 32); no other tripwire may fire.

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
const SRC = join(HERE, "fixtures", "null-write.tsx");
const ENTRY = join(HERE, "fixtures", "null-write-entry.ts");
const MGBA_RUNNER = join(HERE, "harness", "mgba_runner");
const NES_RUNNER = join(HERE, "harness", "nes_runner.ts");

// A: null string write, Right: liveness, B: null number write, Right: liveness
const TAPE = [Button.A, Button.Right, Button.B, Button.Right] as const;
const EXPECTED_SEEN = ["1", "2", "3", "4"];

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
  steps: string[][];
  trips: number;
}

async function runDevice(rig: Rig, source: string, dir: string): Promise<DeviceRun> {
  const t = VAPOR_TARGETS[rig.name];
  const cells = t.width * t.height;
  const app = compileVaporApp(SRC, source, "NULLWRITE", rig.name);
  const rom = join(dir, `null-write.${rig.name}`);
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
  const steps: string[][] = [];
  for (let i = 0; i <= TAPE.length; i++) {
    const hex = parsed.reads[`chars${i}`] as string;
    const board: string[] = [];
    for (let y = 0; y < 3; y++) {
      let row = "";
      for (let x = 0; x < 8; x++) {
        const at = (y * t.width + x) * 2;
        row += String.fromCharCode(parseInt(hex.slice(at, at + 2), 16) || 32);
      }
      board.push(row);
    }
    steps.push(board);
  }
  return { steps, trips: parsed.reads.trips as number };
}

const runs = new Map<VaporTargetName, DeviceRun>();
let source = "";
let styles: ReturnType<typeof compileVaporApp>["styles"];

beforeAll(async () => {
  if (!existsSync(MGBA_RUNNER)) await $`bun ${join(HERE, "harness", "build.ts")}`.quiet();
  source = await Bun.file(SRC).text();
  styles = compileVaporApp(SRC, source, "NULLWRITE", "gba").styles;
  const dir = await mkdtemp(join(tmpdir(), "vapor-nullwrite-"));
  try {
    for (const rig of RIGS) runs.set(rig.name, await runDevice(rig, source, dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 180000);

describe("F3: a write through a null record pointer trips instead of hanging", () => {
  for (const rig of RIGS) {
    test(`${rig.name}: boot frame matches the oracle`, async () => {
      const o = await bootOracle({
        width: VAPOR_TARGETS[rig.name].width,
        height: VAPOR_TARGETS[rig.name].height,
        styles,
        entry: ENTRY,
      });
      const g = o.grid();
      const dev = runs.get(rig.name)!.steps[0];
      // the oracle never sees the bad presses (they throw TypeError there);
      // boot alone is the shared state.
      expect(dev[0]).toBe(g.chars[0].slice(0, 8));
      expect(dev[2]).toBe(g.chars[2].slice(0, 8));
      o.unmount();
    });

    test(`${rig.name}: row 0 is untouched and the counter reaches 4 (frame loop alive)`, () => {
      const dev = runs.get(rig.name)!;
      for (let i = 0; i <= TAPE.length; i++) {
        expect(dev.steps[i][0]).toBe("abcde   "); // no 'Z', no corruption
        expect(dev.steps[i][1]).toBe("        "); // second pool row absent
      }
      for (let i = 0; i < TAPE.length; i++) {
        expect(dev.steps[i + 1][2]).toBe(EXPECTED_SEEN[i] + "       ");
      }
    });

    test(`${rig.name}: both null writes trip VP_TRIP_NULL (bit 5) and nothing else`, () => {
      expect(runs.get(rig.name)!.trips).toBe(32);
    });
  }
});
