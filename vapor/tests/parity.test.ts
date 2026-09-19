// vapor/test/parity.test.ts — the Pocket Vapor claim, executed on three consoles.
//
// One tape of button presses per app drives FOUR implementations of its
// component:
//   oracle: real vue 3.6 runtime-with-vapor over the micro-DOM (JS),
//           booted per target with that console's screen geometry
//   GBA:    compiled ARM7 in headless libmgba          (30x20)
//   GB:     compiled SM83 (sdcc) in headless libmgba   (20x18)
//   NES:    compiled 6502 (cc65) in jsnes              (22x18)
// After every press the logical cell grid (chars + palettes) must match
// cell-for-cell, read from the PVDB debug block each runtime keeps at its
// console's fixed address. GB/NES pacing notes: the GB scenario uses video
// frames with generous hold/release margins (a flush can span frames on a
// 1 MHz SM83); the NES runner paces on the debug frame counter directly.
//
// The same harness loops over CASES, so every app gets the identical
// oracle-vs-three-consoles comparison (todo and sokoban today).

import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";
import { compileVaporApp, VAPOR_TARGETS, type VaporTargetName } from "../compiler/compile.ts";
import type { StyleTable } from "../compiler/styles.ts";
import { buildRom } from "../compiler/rom.ts";
import { bootOracle } from "../oracle/boot.ts";
import { TODO_TAPE } from "./todo-tape.ts";
import { SOKOBAN_TAPE } from "./sokoban-tape.ts";

const HERE = import.meta.dir;
const OUT = join(HERE, "..", "..", "dist", "vapor");
const MGBA_RUNNER = join(HERE, "harness", "mgba_runner");
const NES_RUNNER = join(HERE, "harness", "nes_runner.ts");

interface AppCase {
  name: string;
  entry: string;
  title: string;
  tape: readonly number[];
  /** oracle bundle entry; undefined uses the default todo entry */
  oracleEntry?: string;
}

const CASES: readonly AppCase[] = [
  {
    name: "todo",
    entry: join(HERE, "..", "examples", "todo", "todo.tsx"),
    title: "VAPOR TODO",
    tape: TODO_TAPE,
  },
  {
    name: "sokoban",
    entry: join(HERE, "..", "examples", "sokoban", "sokoban.tsx"),
    title: "SOKOBAN",
    tape: SOKOBAN_TAPE,
    oracleEntry: join(HERE, "..", "oracle", "entry-sokoban.ts"),
  },
];

interface VramProbe {
  cmd: "D" | "V"; // bus read vs PPU read (NES)
  addr: number; // map/nametable base
  stride: number; // entries per hardware row
  entrySize: 1 | 2; // bytes per entry
  orgX: number; // grid origin inside the hardware map
  orgY: number;
}

interface TargetRig {
  name: VaporTargetName;
  ext: string;
  charsAddr: number;
  palsAddr: number;
  tripsAddr: number;
  vram: VramProbe;
  boot: string; // scenario advance before step 0
  press: (mask: number) => string;
  run: (rom: string, scenario: string) => Promise<string>;
}

const RIGS: TargetRig[] = [
  {
    name: "gba",
    ext: "gba",
    charsAddr: 0x2000100,
    palsAddr: 0x2000360,
    tripsAddr: 0x200000c,
    vram: { cmd: "D", addr: 0x6004000, stride: 32, entrySize: 2, orgX: 0, orgY: 0 },
    boot: "A 5",
    press: (mask) => `P ${mask.toString(16)} 2 4`,
    run: async (rom, scenario) => await $`${MGBA_RUNNER} ${rom} ${scenario}`.text(),
  },
  {
    name: "gb",
    ext: "gb",
    charsAddr: 0xd840,
    palsAddr: 0xd9a8,
    tripsAddr: 0xd80c,
    vram: { cmd: "D", addr: 0x9800, stride: 32, entrySize: 1, orgX: 0, orgY: 0 },
    boot: "A 90", // app_init alone spans ~26 video frames on the 1 MHz SM83
    press: (mask) => `P ${mask.toString(16)} 16 40`,
    run: async (rom, scenario) => await $`${MGBA_RUNNER} ${rom} ${scenario}`.text(),
  },
  {
    name: "nes",
    ext: "nes",
    charsAddr: 0x0240,
    palsAddr: 0x03cc,
    tripsAddr: 0x020c,
    vram: { cmd: "V", addr: 0x2000, stride: 32, entrySize: 1, orgX: 5, orgY: 6 },
    boot: "A 5", // engine ticks: the runner paces on the debug frame counter
    press: (mask) => `P ${mask.toString(16)} 2 8`, // release long enough for the 2-row NMI blitter
    run: async (rom, scenario) => await $`bun ${NES_RUNNER} ${rom} ${scenario}`.text(),
  },
];

interface DeviceStep {
  chars: string[];
  pals: number[][];
  /** decoded from real VRAM/nametable: what the player's screen shows */
  vramChars: string[];
  vramStyles: number[][]; // glyph style on GB/NES; palette bank on GBA
}

function decodeGrid(
  charsHex: string,
  palsHex: string,
  vramHex: string,
  probe: VramProbe,
  w: number,
  h: number,
): DeviceStep {
  const chars: string[] = [];
  const pals: number[][] = [];
  for (let y = 0; y < h; y++) {
    let row = "";
    const palRow: number[] = [];
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const code = parseInt(charsHex.slice(i * 2, i * 2 + 2), 16);
      row += String.fromCharCode(code || 32);
      palRow.push(parseInt(palsHex.slice(i * 2, i * 2 + 2), 16));
    }
    chars.push(row);
    pals.push(palRow);
  }
  const vramChars: string[] = [];
  const vramStyles: number[][] = [];
  for (let y = 0; y < h; y++) {
    let row = "";
    const styleRow: number[] = [];
    for (let x = 0; x < w; x++) {
      const at = ((probe.orgY + y) * probe.stride + (probe.orgX + x)) * probe.entrySize;
      let entry = parseInt(vramHex.slice(at * 2, at * 2 + 2), 16);
      if (probe.entrySize === 2) entry |= parseInt(vramHex.slice(at * 2 + 2, at * 2 + 4), 16) << 8;
      const tile = probe.entrySize === 2 ? entry & 0x3ff : entry;
      if (tile === 0) {
        row += "\0"; // never-written cell
        styleRow.push(-1);
      } else {
        row += String.fromCharCode(((tile - 1) % 95) + 0x20);
        styleRow.push(probe.entrySize === 2 ? entry >> 12 : Math.floor((tile - 1) / 95));
      }
    }
    vramChars.push(row);
    vramStyles.push(styleRow);
  }
  return { chars, pals, vramChars, vramStyles };
}

interface RigRun {
  steps: DeviceStep[];
  trips: number;
  styles: StyleTable;
}

// app -> rig -> captured device run
const runs = new Map<string, Map<VaporTargetName, RigRun>>();

beforeAll(async () => {
  if (!existsSync(MGBA_RUNNER)) await $`bun ${join(HERE, "harness", "build.ts")}`.quiet();

  for (const appCase of CASES) {
    const source = await Bun.file(appCase.entry).text();
    const perRig = new Map<VaporTargetName, RigRun>();

    for (const rig of RIGS) {
      const t = VAPOR_TARGETS[rig.name];
      const cells = t.width * t.height;
      const app = compileVaporApp(appCase.entry, source, appCase.title, rig.name);
      const rom = join(OUT, `${appCase.name}.${rig.ext}`);
      await buildRom(app, rig.name, rom);

      const vramLen = (rig.vram.orgY + t.height) * rig.vram.stride * rig.vram.entrySize;
      const probeLines = (i: number) => [
        `D chars${i} 0x${rig.charsAddr.toString(16)} ${cells}`,
        `D pals${i} 0x${rig.palsAddr.toString(16)} ${cells}`,
        `${rig.vram.cmd} vram${i} 0x${rig.vram.addr.toString(16)} ${vramLen}`,
      ];
      const lines: string[] = [rig.boot, ...probeLines(0)];
      appCase.tape.forEach((b, i) => {
        lines.push(rig.press(1 << b));
        lines.push(...probeLines(i + 1));
      });
      lines.push(`R trips 0x${rig.tripsAddr.toString(16)} 1`);
      const scenario = join(OUT, `parity-${appCase.name}-${rig.name}.txt`);
      await Bun.write(scenario, lines.join("\n") + "\n");

      const out = await rig.run(rom, scenario);
      const parsed = JSON.parse(out) as { ok: boolean; reads: Record<string, string | number> };
      expect(parsed.ok).toBe(true);
      const steps: DeviceStep[] = [];
      for (let i = 0; i <= appCase.tape.length; i++) {
        steps.push(
          decodeGrid(
            parsed.reads[`chars${i}`] as string,
            parsed.reads[`pals${i}`] as string,
            parsed.reads[`vram${i}`] as string,
            rig.vram,
            t.width,
            t.height,
          ),
        );
      }
      perRig.set(rig.name, { steps, trips: parsed.reads.trips as number, styles: app.styles });
    }
    runs.set(appCase.name, perRig);
  }
}, 300000);

for (const appCase of CASES) {
  describe(`${appCase.name}: oracle == device, three consoles`, () => {
    for (const rig of RIGS) {
      test(`${rig.name}: every step of the tape renders identically`, async () => {
        const t = VAPOR_TARGETS[rig.name];
        const run = runs.get(appCase.name)!.get(rig.name)!;
        const oracle = await bootOracle({
          width: t.width,
          height: t.height,
          styles: run.styles,
          entry: appCase.oracleEntry,
        });
        const compare = (step: number, label: string) => {
          const want = oracle.grid();
          const got = run.steps[step];
          for (let y = 0; y < t.height; y++) {
            expect(`${label} y=${y}: ${got.chars[y]}`).toBe(`${label} y=${y}: ${want.chars[y]}`);
            expect(`${label} y=${y} pal: ${got.pals[y].join(",")}`).toBe(
              `${label} y=${y} pal: ${want.pals[y].join(",")}`,
            );
            // the player's screen, not just the logical grid: decoded VRAM
            expect(`${label} y=${y} vram: ${got.vramChars[y]}`).toBe(`${label} y=${y} vram: ${want.chars[y]}`);
            const styleMap = run.styles.lower(rig.name).styleMap;
            const wantStyle =
              rig.name === "gba"
                ? want.pals[y].join(",")
                : want.pals[y].map((palId) => styleMap[palId]).join(",");
            expect(`${label} y=${y} vstyle: ${got.vramStyles[y].join(",")}`).toBe(
              `${label} y=${y} vstyle: ${wantStyle}`,
            );
          }
        };
        compare(0, `${appCase.name}/${rig.name} boot`);
        for (let i = 0; i < appCase.tape.length; i++) {
          await oracle.press(appCase.tape[i]);
          compare(i + 1, `${appCase.name}/${rig.name} step ${i} (btn ${appCase.tape[i]})`);
        }
        oracle.unmount();
      });

      test(`${rig.name}: no runtime tripwires fired`, () => {
        expect(runs.get(appCase.name)!.get(rig.name)!.trips).toBe(0);
      });
    }
  });
}
