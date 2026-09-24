// vapor/tests/cap-write-parity.test.ts — Reviewer 1094 F4 regression,
// cherry-picked from repro/review-1094/cap-write-parity.test.ts on
// fleet/task-1094. It is the one mutation neither board-parity nor the
// reviewer's own 17-press tape caught: relaxing vp_sb_put's upper bound
// from `i >= len` to `i > len`. Record 0's string is filled to the target's
// strCap, so b[len] is the NEXT pool record's len byte: the off-by-one
// renders row 1 as garbage and clears the tripwire.
//
// Verified red under that mutation (2 fail) and green on the clean tree.

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
const SRC = join(HERE, "fixtures", "cap-write.tsx");
const ENTRY = join(HERE, "fixtures", "cap-write-entry.ts");
const MGBA_RUNNER = join(HERE, "harness", "mgba_runner");

const TAPE = [Button.A, Button.A] as const;

const ROWS = 3;
const WIDTH = 26;

interface Rig {
  name: VaporTargetName;
  charsAddr: number;
  tripsAddr: number;
  boot: string;
  press: (mask: number) => string;
  run: (rom: string, scenario: string) => Promise<string>;
}

const RIGS: Rig[] = [
  // gba only: strCap 24 == the seeded row length and the 30-wide grid can
  // show all 26 compared columns. gb truncates nothing but is 20 wide; nes
  // has strCap 20, so the seed truncates and trips STR_TRUNC as well.
  {
    name: "gba",
    charsAddr: 0x2000100,
    tripsAddr: 0x200000c,
    boot: "A 5",
    press: (mask) => `P ${mask.toString(16)} 2 4`,
    run: async (rom, scenario) => await $`${MGBA_RUNNER} ${rom} ${scenario}`.text(),
  },
];

interface DeviceRun {
  steps: string[][];
  trips: number;
}

async function runDevice(rig: Rig, source: string, dir: string): Promise<DeviceRun> {
  const t = VAPOR_TARGETS[rig.name];
  const cells = t.width * t.height;
  const app = compileVaporApp(SRC, source, "CAPWRITE", rig.name);
  const rom = join(dir, `cap-write.${rig.name}`);
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
    for (let y = 0; y < ROWS; y++) {
      let row = "";
      for (let x = 0; x < WIDTH; x++) {
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
  styles = compileVaporApp(SRC, source, "CAPWRITE", "gba").styles;
  const dir = await mkdtemp(join(tmpdir(), "vapor-capwrite-"));
  try {
    for (const rig of RIGS) runs.set(rig.name, await runDevice(rig, source, dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 180000);

describe("F4: putChar at index == len == strCap must not touch the next pool record", () => {
  for (const rig of RIGS) {
    test(`${rig.name}: a full-capacity row and its neighbour survive a write at index == len`, async () => {
      const o = await bootOracle({
        width: VAPOR_TARGETS[rig.name].width,
        height: VAPOR_TARGETS[rig.name].height,
        styles,
        entry: ENTRY,
      });
      const dev = runs.get(rig.name)!;
      const oracleBoard = () => {
        const g = o.grid();
        return [0, 1, 2].map((y) => g.chars[y].slice(0, WIDTH));
      };
      const compare = (step: number, label: string) => {
        const want = oracleBoard();
        const got = dev.steps[step];
        for (let y = 0; y < ROWS; y++) {
          expect(`${label} y=${y}: ${got[y]}`).toBe(`${label} y=${y}: ${want[y]}`);
        }
      };
      compare(0, `${rig.name} boot`);
      for (let i = 0; i < TAPE.length; i++) {
        await o.press(TAPE[i]);
        compare(i + 1, `${rig.name} step ${i} (btn ${TAPE[i]})`);
      }
      o.unmount();
    });

    test(`${rig.name}: the at-capacity write trips VP_TRIP_INDEX`, () => {
      expect(runs.get(rig.name)!.trips).toBe(16);
    });
  }
});
