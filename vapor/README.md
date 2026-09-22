# Pocket Vapor

**Early experiment, not a PocketJS mainline feature. See the [repository README](../README.md) for setup and status.**

**Vue Vapor, compiled all the way down.** You write a component in a strict
TypeScript subset of Vue Vapor — real `ref`/`computed`, real JSX — and the
Pocket Vapor compiler emits native code for devices that could never host
a JavaScript engine: **ARM7 on the Game Boy Advance, SM83 on the Game Boy,
6502 on the NES, Xtensa LX6 on the ESP32, and Cortex-M7 on Playdate**. No JS engine, no GC, no
allocator. Vue Vapor compiles the virtual DOM away; Pocket Vapor compiles
the JavaScript engine away.

| GBA (arm-none-eabi-gcc) | GBA edit mode |
|---|---|
| ![boot](docs/todo-boot.png) | ![edit](docs/todo-edit.png) |

| Game Boy (sdcc, 20x18) | NES (cc65, 22x18) |
|---|---|
| ![gb](docs/todo-gb.png) | ![nes](docs/todo-nes.png) |

The portable Todo component targets the oracle on real vue 3.6, three
cartridges, and ESP32 firmware. Its Playdate input variant shares the same
business model and rendering vocabulary while replacing list Up/Down with
the generic relative-axis input supplied by the crank. Screen geometry is a compile-time
constant (`SCREEN.width`/`SCREEN.height` from the host module): layout math
and width ternaries fold per target, so the narrow help strings on
GB/NES/ESP32 cost zero bytes on GBA — compile-time responsive UI.

The proof is [`examples/todo/todo.tsx`](examples/todo/todo.tsx), plus the
Playdate control mapping in
[`examples/todo/todo.playdate.tsx`](examples/todo/todo.playdate.tsx) —
TodoMVC with filters, a computed remaining-count, windowed scrolling and a
glyph editor. Each component runs two ways:

- **Oracle**: unmodified on `vue@3.6` `runtime-with-vapor` (through the
  repo's vue-jsx-vapor pipeline) over a micro-DOM, in bun.
- **Device**: compiled to C by `vapor/compiler/compile.ts`, linked against a
  target runtime, and run as native code on a console or ESP32 — still with
  no JavaScript engine.

The parity suite drives one tape of button presses through the oracle and
each console emulator, then compares the rendered logical cell grid —
characters *and* palettes — cell-for-cell after every press. The ESP32
device verifier applies the same contract over UART to the physical board;
it is an opt-in hardware check, not a claim made by the emulator-only test
suite.

```
$ bun test vapor/tests/                 # incl. 3-console per-press parity

$ bun vapor/compiler/cli.ts vapor/examples/todo/todo.tsx
== reactive graph ==
refs:      todos cursor filter editing draft glyph      (6 dirty bits)
computeds: filtered remaining current scroll visible    (masks inferred)
effects:   eff_0 rows [1,2)   mask {todos, filter}
           eff_1 rows [3,15)  mask {todos, cursor, filter}
           eff_2 rows [17,18) mask {editing, draft, glyph}
           eff_3 rows [19,20) mask {editing}
== memory plan ==
state RAM: 41 B scalars/strings + 833 B pools + 66 B computed views
dist/vapor/todo.gba  (9.1 KB)
```

The business logic is keymaps, not branch ladders — and the compiler meets
the style: each named action becomes one C function, each keymap becomes a
10-slot function-pointer table in ROM, and the dispatch line becomes a
bounds-checked indexed call:

```tsx
const listKeys: Keymap = {
  [Button.Up]: () => moveCursor(-1),
  [Button.Down]: () => moveCursor(1),
  [Button.A]: toggleDone,
  [Button.B]: deleteCurrent,
  [Button.R]: cycleFilter,
  [Button.Select]: clearDone,
  [Button.Start]: openEditor,
};

onButton((b) => (editing.value ? editKeys : listKeys)[b]?.());
```

Incremental controls are a separate, hardware-neutral input capability:

```tsx
onAxisDelta(RelativeAxis.Primary, (delta) => {
  if (!editing.value) {
    remainder.value += delta;
    const steps = Math.trunc(
      remainder.value / (45 * RelativeAxisUnits.PerDegree),
    );
    remainder.value %= 45 * RelativeAxisUnits.PerDegree;
    moveCursor(steps);
  }
});
```

The generated ABI receives signed canonical deltas. Rotary hosts normalize
physical movement to millidegrees but do not choose a UI detent. The Playdate
Todo chooses 45 degrees itself; a future ESP32 board can map an encoder or
wheel to the same axis without exposing GPIO or Playdate APIs to the app.

Deleting is `todos.value = todos.value.filter((x) => x !== t)` (compiled to
in-place pool compaction), and the selected todo is itself a computed —
`const current = computed(() => filtered.value[cursor.value])` — cached as
a nullable record pointer with the same validity-bit laziness as any other
computed.

The view is semantic components, not raw rows — real vapor functional
components under the oracle, **inlined to zero-cost paint code** by the
compiler (props substitute at the AST level, so const folding, dependency
masks and row spans all see through; six components add zero effects and
zero RAM):

```tsx
function TodoRow(props: { line: number; todo: Todo; selected: boolean }) { … }

<TitleBar line={0} text="POCKET VAPOR TODO" />
<StatusBar line={1} count={remaining.value} label={FILTERS[filter.value]} />
{visible.value.map((t, i) => (
  <TodoRow line={LIST_Y + i} todo={t} selected={t === current.value} />
))}
{editing.value ? <EditorBar line={17} draft={draft.value} glyph={GLYPHS[glyph.value]} /> : null}
```

Reactivity survives compilation as data: every ref is a dirty bit, every
dependency edge is a bitmask baked into ROM, computeds are lazy cached
functions with validity bits, and template bindings are paint effects that
run only when their mask intersects the dirty word. Pressing a button that
changes nothing costs zero repaints; pressing ↑ repaints only the list
block. See [DESIGN.md](DESIGN.md) for the whole argument, including where
it deliberately over-approximates Vue (static dependency analysis).

The look is declarative now — the same Tailwind names the big framework
compiles, lowered through each target's style contract (GBA: real palette
banks; ESP32: RGB565 ink/paper pairs; GB/NES: two glyph styles by
luminance), with the whole diagnostics matrix one command away:

```tsx
<row y={0} class="bg-emerald-500 text-slate-950 align-center">
<row class={selected ? "bg-slate-100 text-slate-950" : done ? "text-slate-500" : ""}>
```

```
$ bun run vapor:check
gba     OK    30x20, 6 style pairs
gb      OK    20x18, 6 style pairs
        warn  VS104: 3 distinct color pairs render as the same glyph style ...
nes     OK    22x18, 6 style pairs
        warn  VS104: 3 distinct color pairs render as the same glyph style ...
esp32   OK    20x18, 6 style pairs
playdate FAIL
        error VT101: playdate has no physical input for Select, Start, R ...
meowbit OK    board (esp32)
        warn  VB103: "start" is only reachable as the a+b chord on meowbit ...
$ bun vapor/compiler/cli.ts check app.tsx --strict   # lossy lowering = failure
$ bun vapor/compiler/cli.ts check app.tsx --json     # demands + verdicts as data
```

That failure is intentional for the portable button-only file. Checking
`todo.playdate.tsx` reports Playdate support through its six direct buttons
and `RelativeAxis.Primary`; targets without a relative-axis adapter fail
with `VT102`.

Board rows are the AOT admission rule at work: MCU devices are data files
(`boards/meowbit.json`), the compiler derives what the app demands (buttons
used, style pairs, grid), and `check` judges every registered board against
them — see [BOARDS.md](BOARDS.md) for how this scales past one store's
ability to enumerate devices.

And the oracle is visible: `bun run vapor:dev` serves the app on real Vue
Vapor in your browser — inspectable DOM rows, keyboard as the pad,
`?target=gb` to see the DMG's two-style world before you burn a cart,
`?target=esp32` to preview the MeowBit viewport, or `?target=playdate` for
the 50×30 one-bit contract.

## Pocket Sokoban

The second real workload (after Todo) is a playable **Sokoban**: 24 puzzles
from David W. Skinner's freely-distributed [Microban](http://sneezingtiger.com/sokoban/levels/microbanText.html)
set (attribution required and shown on every screen), d-pad movement and
pushing, a 64-step undo pool, a level chooser and solve detection. Two entry
files share their level data and record shapes:
[`examples/sokoban/sokoban.tsx`](examples/sokoban/sokoban.tsx) targets
GBA/GB/NES/ESP32 and [`sokoban.playdate.tsx`](examples/sokoban/sokoban.playdate.tsx)
is the Playdate input variant. The only control differences the hardware
forces: Playdate has no Start/Select, so **A opens the chooser and two A
presses restart** (open → confirm the current slot), and the **crank scrubs
undo/redo at one 45° detent per step** — anti-clockwise undo, clockwise
redo, the redo stack cleared by any fresh move. The board is eight pooled
10-char string rows (the NES pool holds exactly eight) over a flat
1920-byte level ROM; undo is a second pool of packed one-byte steps.

| Game Boy Advance (30×20) | Game Boy (sdcc, 20×18) | NES (cc65, 22×18) |
|---|---|---|
| ![gba](docs/sokoban-gba.png) | ![gb](docs/sokoban-gb.png) | ![nes](docs/sokoban-nes.png) |

Numbers measured 2026-09 on this machine (compile wall time includes the
native link; `check` for the variant is frontend-only):

| target | ROM bytes | state RAM (scalars + pools) | overlay | reactive tables | effects | compile |
|---|---|---|---|---|---|---|
| GBA | 11444 B `sokoban.gba` | 28 B + 266 B | 65 B / 1 slot | 9 dirty, 5 effects | 5 | ~0.5 s |
| GB | 32768 B `sokoban.gb` (padded) | 28 B + 266 B | 65 B / 1 slot | 9 dirty, 5 effects | 5 | ~4.6 s |
| NES | 40976 B `sokoban.nes` (padded) | 28 B + 234 B | 65 B / 1 slot | 9 dirty, 5 effects | 5 | ~0.3 s |
| ESP32 | check OK (no IDF here to link) | 28 B + 266 B | 65 B / 1 slot | 9 dirty, 5 effects | 5 | — |
| Playdate | check OK + generated C compiles (`-Werror`); no SDK on this machine, **not built with pdc or run on a device** | 32 B + 331 B | 130 B / 2 slots | 11 dirty, 5 effects | 5 | ~0.3 s (5-target check) |

The Playdate variant's extra redo pool and crank-remainder ref account for
the 4 scalar bytes and larger pools; both files render five paint effects
with identical masks. **An 83-key tape replays cell-for-cell — characters,
palettes and decoded VRAM — across the oracle and the GBA, GB and NES
emulators after every press, with zero runtime tripwires**; a second tape
crosses the 64-record pool and proves the 65th legal move is refused and 64
undos restore the level. Key-to-picture settles in **one frame** on GBA.

Logic sharing across the two entries is deliberately honest: the P1-d
local-const import covers data and interfaces only (module helpers are
void, take solely `:number` params, and may touch neither refs nor host
APIs), so both files import `levels.ts` (the 1920-byte ROM + geometry) and
`shared.ts` (the `Line`/`Hist` record shapes, layout constants, pads) while
the ref/`putChar`-driven rule helpers are duplicated text pinned to the same
oracle semantics — lifting them needs one more compiler extension, recorded
in `shared.ts`. The console file checks OK on GBA/GB/NES/ESP32; the variant
checks OK on Playdate (no VT101) and, exactly like `todo.playdate.tsx`,
reports VT102 on the four axis-less targets since a crank-consuming file has
no adapter there.

Levels: **Microban Copyright © David W. Skinner**
(sasquatch@bentonrea.com), carried with attribution; source URL and the
per-slot selection rationale are in the header of
[`examples/sokoban/levels.ts`](examples/sokoban/levels.ts).

## Commands

The ESP32 `flash` and default `verify` commands below write the connected
board; make a full-flash backup first as described in
[`runtime/esp32/README.md`](runtime/esp32/README.md). The standalone
`todo.esp32.bin` is app-only and, if written manually, belongs at
`0x10000`—never offset zero. Prefer the segmented flash script.

```sh
bun vapor/compiler/cli.ts vapor/examples/todo/todo.tsx                 # → dist/vapor/todo.gba
bun vapor/compiler/cli.ts vapor/examples/todo/todo.tsx --target gb     # → todo.gb  (32 KB)
bun vapor/compiler/cli.ts vapor/examples/todo/todo.tsx --target nes    # → todo.nes (40 KB)
bun vapor/compiler/cli.ts check vapor/examples/sokoban/sokoban.tsx           # GBA/GB/NES/ESP32 OK
bun vapor/compiler/cli.ts check vapor/examples/sokoban/sokoban.playdate.tsx  # Playdate OK (VT102 on consoles)
bun run vapor:esp32                                        # → app-only todo.esp32.bin + gen-esp32/
bun run vapor:playdate                                     # → crank-driven Todo Simulator .pdx
bun run vapor:playdate:device                              # → crank-driven Todo device .pdx
bun run vapor:playdate:both                                # → both independent .pdx packages
bun run vapor:playdate:smoke                               # → six-button regression fixture
bun run vapor:esp32:flash                                  # build + flash the connected ESP32 MeowBit
bun run vapor:esp32:verify                                 # build + flash + replay the Vue-oracle tape
bun vapor/scripts/play.ts                                 # build + open in mGBA
bun vapor/scripts/dev.ts [app.tsx]                        # visible oracle in the browser
bun vapor/compiler/cli.ts check <app.tsx> [--strict]      # cross-target diagnostics matrix
bun vapor/scripts/shot.ts                                 # bake docs screenshots
bun test vapor/tests/                                     # oracle + compiler + 3-console parity + shared device tape
```

Toolchains: `arm-none-eabi-gcc` + `mgba` (GBA/GB), `sdcc` + `rgbfix` (GB),
`cc65` (NES, emulated by the jsnes dev-dependency), **ESP-IDF v6.0.2**,
and the Playdate SDK CMake/pdc toolchain
(set `IDF_PATH` / `IDF_TOOLS_PATH` for ESP32 when auto-discovery does not
find the installation). Oracle tests run with bun alone. Notable per-target facts the
runtime absorbs: the console shadow grid IS the debug block (fixed
WRAM/CPU-RAM addresses), so the harness reads the logical screen even while
a 1 MHz SM83 trickles VRAM through vblank; DMG has one palette, so logical
palettes map to baked glyph styles; NES fits grid + pool + views into 2 KB
of CPU RAM with the font in CHR-ROM; ESP32 rasterizes the same logical
20×18 grid into RGB565 on a 160×128 ST7735; Playdate maps a 50×30 grid
byte-for-cell into its 400×240 1bpp framebuffer; and sdcc 4.6's SM83 port
miscompiles some u8-by-u8 multiplies, so generated indexing is u16 pointer
arithmetic and bit masks come from a ROM table.

## Layout

```
vapor/
  DESIGN.md            the thesis + subset + target/style contracts
  examples/todo/       portable Todo + Playdate relative-axis input variant
  examples/sokoban/    Microban Sokoban + Playdate crank variant (shared.ts/levels.ts)
  host/                input.ts (buttons + relative axes), screen.ts (SCREEN geometry)
  oracle/              micro-DOM + grid painter + bundle boot (real vue)
  compiler/            compile.ts (TS AST → C), styles.ts (class DSL), rom.ts, cli.ts
  runtime/             vapor.h contract + vapor_core.c (shared grid/strings/line)
  runtime/gba|gb|nes/  per-console halves: crt0, video commit, input, debug block
  runtime/esp32/       ESP-IDF loop, ST7735 RGB565 raster, buttons, UART receipt
  runtime/playdate/    SDK lifecycle, raw 1bpp framebuffer, buttons + crank adapter
  scripts/             dev.ts (visible oracle), play.ts, shot.ts, esp32.ts (device protocol)
  tests/               styles + compiler + oracle + 3-console parity + shared device tape
  tests/harness/       headless libmgba runner (GBA+GB) + jsnes runner (NES)
```
