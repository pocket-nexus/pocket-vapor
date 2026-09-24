// vapor/tests/board-parity.test.ts — the record string-field read + in-place
// write, executed on device (GBA via mGBA, NES via jsnes) and compared
// cell-for-cell with real Vue Vapor (the oracle).
//
// One tape drives BOTH: a cursor walks a 7-wide pooled STRING-row board, A
// toggles the cell under it (dynamic-index read, putChar in-place write),
// Select writes one byte past the end (no-op + VP_TRIP_INDEX on device).
// After every press the first H rows of the logical cell grid must match
// the oracle's exactly.

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
const SRC = join(HERE, "fixtures", "board.tsx");
const ENTRY = join(HERE, "fixtures", "board-entry.ts");
const MGBA_RUNNER = join(HERE, "harness", "mgba_runner");
const NES_RUNNER = join(HERE, "harness", "nes_runner.ts");

// toggle at (0,0); walk and toggle (1,0), (0,1); bad write; walk back and
// untoggle (0,0).
const TAPE = [
  Button.A,
  Button.Right,
  Button.A,
  Button.Down,
  Button.Left,
  Button.A,
  Button.Select,
  Button.Up,
  Button.A,
] as const;

const ROWS = 3; // board rows (cursor row 3 is not compared)
const WIDTH = 7;

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
    boot: "A 90", // a flush can span video frames on the 1 MHz SM83
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
  const app = compileVaporApp(SRC, source, "BOARD", rig.name);
  const ext = rig.name;
  const rom = join(dir, `board.${ext}`);
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
  styles = compileVaporApp(SRC, source, "BOARD", "gba").styles;
  const dir = await mkdtemp(join(tmpdir(), "pocket-vapor-board-"));
  try {
    for (const rig of RIGS) runs.set(rig.name, await runDevice(rig, source, dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 120000);

describe("oracle == device: pooled string-row board read + in-place write", () => {
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

    test(`${rig.name}: the out-of-range write trips VP_TRIP_INDEX (bit 4) but nothing else`, () => {
      // Select is the only bad write; no pool-full/str-trunc/view/render trips.
      expect(runs.get(rig.name)!.trips).toBe(16);
    });
  }
});
