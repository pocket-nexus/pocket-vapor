// vapor/tests/charboard-parity.test.ts — D207 char-vs-one-char-literal
// comparisons, executed on device (GBA via mGBA, GB via sdcc+mGBA, NES via
// cc65+jsnes) and compared cell-for-cell with real Vue Vapor (the oracle).
//
// The tape walks into walls (record-field char === "#") and marks floor cells
// (ROM const-string char !== "#"); the failing sdcc/cc65 fork is exactly why
// these comparisons must lower to C char literals. After every press rows
// 0..2 (board, cursor x, mark count) must match the oracle.

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
const SRC = join(HERE, "fixtures", "charboard.tsx");
const ENTRY = join(HERE, "fixtures", "charboard-entry.ts");
const MGBA_RUNNER = join(HERE, "harness", "mgba_runner");
const NES_RUNNER = join(HERE, "harness", "nes_runner.ts");

// cx starts at 1 on "#..#": left wall-block, right to 2, right wall-block,
// mark (floor), left to 1, mark, left wall-block, mark, right to 2, mark.
const TAPE = [
  Button.Left,
  Button.Right,
  Button.Right,
  Button.A,
  Button.Left,
  Button.A,
  Button.Left,
  Button.A,
  Button.Right,
  Button.A,
] as const;

const EXPECTED_X = [1, 1, 2, 2, 2, 1, 1, 1, 1, 2, 2];
const EXPECTED_MARKS = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4];

const ROWS = 3; // board row, cursor row, marks row
const WIDTH = 4;

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
    run: (rom, scenario) => $`bun ${NES_RUNNER} ${rom} ${scenario}`.text(),
  },
];

interface DeviceRun {
  steps: string[][];
  trips: number;
}

async function runDevice(rig: Rig, source: string, dir: string): Promise<DeviceRun> {
  const t = VAPOR_TARGETS[rig.name];
  const cells = t.width * t.height;
  const app = compileVaporApp(SRC, source, "CHARBOARD", rig.name);
  const rom = join(dir, `charboard.${rig.name}`);
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
  styles = compileVaporApp(SRC, source, "CHARBOARD", "gba").styles;
  const dir = await mkdtemp(join(tmpdir(), "pocket-vapor-charboard-"));
  try {
    for (const rig of RIGS) runs.set(rig.name, await runDevice(rig, source, dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 120000);

describe("oracle == device: char vs one-char literal comparisons (D207)", () => {
  for (const rig of RIGS) {
    test(`${rig.name}: every tape step matches the oracle cell-for-cell`, async () => {
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

    test(`${rig.name}: the wall/floor logic tracks the expected cursor and marks`, () => {
      const dev = runs.get(rig.name)!;
      for (let i = 0; i <= TAPE.length; i++) {
        expect(dev.steps[i][1]).toBe(String(EXPECTED_X[i]).padEnd(WIDTH));
        expect(dev.steps[i][2]).toBe(String(EXPECTED_MARKS[i]).padEnd(WIDTH));
      }
    });

    test(`${rig.name}: no runtime tripwires fired`, () => {
      expect(runs.get(rig.name)!.trips).toBe(0);
    });
  }
});
