#!/usr/bin/env bun
// Record the Pocket Sokoban parity tape on real emulator framebuffers.
//
// The GBA capture records every emulated frame (two held + four released per
// key). The looping GIF samples every third frame at 10 fps; the MP4 retains
// all frames at 30 fps. Both use 3x nearest-neighbour scaling and take about
// 17 seconds for the complete 83-key tape. The same script captures the solved
// frame on GB and NES so the three-console output can be compared directly.
//
// Requires ffmpeg on PATH. Transient PPM frames stay under ignored dist/ and
// are removed after encoding; maintained output is written to vapor/docs/.

//   bun vapor/scripts/demo-gif.ts

// This is an early Pocket Vapor experiment, not a PocketJS mainline feature.


import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import { createCanvas } from "@napi-rs/canvas";
import { compileVaporApp } from "../compiler/compile.ts";
import { buildRom } from "../compiler/rom.ts";
import { SOKOBAN_TAPE } from "../tests/sokoban-tape.ts";

const HERE = import.meta.dir;
const ROOT = join(HERE, "..", "..");
const ENTRY = join(HERE, "..", "examples", "sokoban", "sokoban.tsx");
const OUT = join(ROOT, "dist", "vapor");
const DOCS = join(HERE, "..", "docs");
const MGBA_RUNNER = join(HERE, "..", "tests", "harness", "mgba_runner");
const NES_RUNNER = join(HERE, "..", "tests", "harness", "nes_runner.ts");
const FFMPEG = Bun.which("ffmpeg");

if (!FFMPEG) throw new Error("ffmpeg is required to encode the Sokoban demo");
if (SOKOBAN_TAPE.length !== 83) {
  throw new Error(`expected the 83-key parity tape, got ${SOKOBAN_TAPE.length} keys`);
}

await mkdir(OUT, { recursive: true });
await mkdir(DOCS, { recursive: true });
// The recorder uses the K scenario command, so rebuild even when an older
// checked-out runner binary already exists.
await $`bun ${join(HERE, "..", "tests", "harness", "build.ts")}`.quiet();

const source = await Bun.file(ENTRY).text();
const frameDir = await mkdtemp(join(OUT, "sokoban-demo-frames-"));
const gif = join(DOCS, "sokoban-demo.gif");
const mp4 = join(DOCS, "sokoban-demo.mp4");
const gbPng = join(DOCS, "sokoban-demo-gb.png");
const nesPng = join(DOCS, "sokoban-demo-nes.png");

const mask = (button: number): string => (1 << button).toString(16);
const press = (button: number, hold: number, release: number): string =>
  `P ${mask(button)} ${hold} ${release}`;
const framePath = (frame: number): string => join(frameDir, `gba-${String(frame).padStart(4, "0")}.ppm`);

async function ppmToPng(src: string, dst: string, scale = 3): Promise<void> {
  const bytes = new Uint8Array(await Bun.file(src).arrayBuffer());
  const header = new TextDecoder().decode(bytes.slice(0, 64));
  const match = header.match(/^P6\n(\d+) (\d+)\n255\n/);
  if (!match) throw new Error(`not a P6 PPM: ${src}`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  const offset = match[0].length;
  const canvas = createCanvas(width * scale, height * scale);
  const context = canvas.getContext("2d");
  const image = context.createImageData(width * scale, height * scale);
  for (let y = 0; y < height * scale; y++) {
    for (let x = 0; x < width * scale; x++) {
      const sx = (x / scale) | 0;
      const sy = (y / scale) | 0;
      const sourceAt = offset + (sy * width + sx) * 3;
      const destAt = (y * width * scale + x) * 4;
      image.data[destAt] = bytes[sourceAt];
      image.data[destAt + 1] = bytes[sourceAt + 1];
      image.data[destAt + 2] = bytes[sourceAt + 2];
      image.data[destAt + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  await Bun.write(dst, canvas.toBuffer("image/png"));
}

async function captureSolvedStill(target: "gb" | "nes", dest: string): Promise<void> {
  const ext = target;
  const app = compileVaporApp(ENTRY, source, "SOKOBAN", target);
  const rom = join(OUT, `sokoban-demo.${ext}`);
  await buildRom(app, target, rom);
  const ppm = join(frameDir, `sokoban-demo-${target}.ppm`);
  const pacing = target === "gb" ? { boot: 120, hold: 16, release: 40 } : { boot: 10, hold: 2, release: 8 };
  const lines = [
    `A ${pacing.boot}`,
    ...SOKOBAN_TAPE.slice(0, 73).map((button) => press(button, pacing.hold, pacing.release)),
    `S ${ppm}`,
  ];
  const scenario = join(frameDir, `sokoban-demo-${target}.txt`);
  await Bun.write(scenario, lines.join("\n") + "\n");
  if (target === "gb") await $`${MGBA_RUNNER} ${rom} ${scenario}`.quiet();
  else await $`bun ${NES_RUNNER} ${rom} ${scenario}`.quiet();
  await ppmToPng(ppm, dest);
}

try {
  const app = compileVaporApp(ENTRY, source, "SOKOBAN", "gba");
  const rom = join(OUT, "sokoban-demo.gba");
  await buildRom(app, "gba", rom);

  let frame = 0;
  const lines = ["A 6", `S ${framePath(frame++)}`];
  for (const button of SOKOBAN_TAPE) {
    lines.push(`K ${mask(button)}`);
    for (let held = 0; held < 2; held++) lines.push("A 1", `S ${framePath(frame++)}`);
    lines.push("K 0");
    for (let released = 0; released < 4; released++) lines.push("A 1", `S ${framePath(frame++)}`);
  }
  const scenario = join(frameDir, "sokoban-demo-gba.txt");
  await Bun.write(scenario, lines.join("\n") + "\n");
  await $`${MGBA_RUNNER} ${rom} ${scenario}`.quiet();

  const input = join(frameDir, "gba-%04d.ppm");
  const gifSampleAndScale =
    "select='not(mod(n\,3))',setpts=N/(10*TB),scale=iw*3:ih*3:flags=neighbor";
  const gifFilter =
    `${gifSampleAndScale},split[frames][palette_source];` +
    "[palette_source]palettegen=max_colors=64:stats_mode=diff[palette];" +
    "[frames][palette]paletteuse=dither=none:diff_mode=rectangle";
  await $`${FFMPEG} -hide_banner -loglevel error -y -framerate 60 -i ${input} -filter_complex ${gifFilter} -fps_mode vfr -loop 0 ${gif}`;
  const mp4Scale = "setpts=N/(30*TB),scale=iw*3:ih*3:flags=neighbor,format=yuv420p";
  await $`${FFMPEG} -hide_banner -loglevel error -y -framerate 60 -i ${input} -vf ${mp4Scale} -r 30 -c:v libx264 -crf 12 -preset slow -movflags +faststart -an ${mp4}`;

  await captureSolvedStill("gb", gbPng);
  await captureSolvedStill("nes", nesPng);

  const gifBytes = (await stat(gif)).size;
  if (gifBytes >= 8 * 1024 * 1024) {
    throw new Error(`GIF is ${gifBytes} bytes; expected less than 8 MiB`);
  }
  console.log(`captured ${frame} GBA frames from ${SOKOBAN_TAPE.length} keys`);
  console.log("story steps: push 10, wall block 4, undo 19, chooser 29-39, SOLVED 73");
  console.log(`${gif} (${gifBytes} bytes, 3x, looping)`);
  console.log(`${mp4} (${(await stat(mp4)).size} bytes, 3x)`);
  console.log(`${gbPng} (${(await stat(gbPng)).size} bytes, solved after step 73)`);
  console.log(`${nesPng} (${(await stat(nesPng)).size} bytes, solved after step 73)`);
} finally {
  await rm(frameDir, { recursive: true, force: true });
}
