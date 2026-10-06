# Pocket Vapor

**Early experiment. Pocket Vapor is not a PocketJS mainline feature, production runtime, or supported way to run arbitrary TypeScript applications.** Its compiler, APIs and target support may change without compatibility guarantees.

Pocket Vapor compiles a strict TypeScript subset with Vue-style reactivity and TSX into native C for GBA, Game Boy, NES, ESP32 and Playdate. Device state uses statically planned storage. A real Vue Vapor runtime provides a development oracle on the host; it is not shipped to these devices.

This repository contains the compiler, board definitions, native runtimes, examples, oracle, test harnesses, design notes and original article/media. It has no build dependency on a PocketJS checkout or package. PocketJS's separate Vue Vapor guest renderer remains part of PocketJS.

## Start

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test:core
bun run vapor:check
bun run vapor:dev
```

`vapor:check` prints admission results for every target. The button-only Todo deliberately fails Playdate admission; the Playdate example uses the relative-axis contract.

With the console toolchains installed:

```sh
bun run vapor                # build the GBA Todo ROM
bun run vapor:gb
bun run vapor:nes
bun test vapor/tests/ --max-concurrency 1 --timeout 120000
```

Console parity needs ARM GCC, SDCC with SM83 support, RGBDS, cc65, clang and libmgba. The libmgba harness discovers Homebrew by default; set `MGBA_PREFIX` elsewhere. Set `CC65_LIB` to the path of `none.lib` when it is not under `/opt/homebrew/share/cc65/lib/`. ESP32 firmware and Playdate packages need their respective SDKs. Host tests do not prove physical-device behavior.

## Optional GBA source art

`bun run gba:imagegen --out dist/imagegen/gba-source.png --dry-run` previews the
asset prompt. Omit `--dry-run` to use a locally authenticated Codex app-server
and ImageGen. This optional tool produces PNG source art; the repository does
not include a bitmap-to-cartridge extractor. Its workflow is documented in
[the migrated skill](skills/pocketjs-gba-imagegen/SKILL.md).

## Source and documentation

- [Compiler, examples, commands and runtime layout](vapor/README.md)
- [Language subset and lowering](vapor/DESIGN.md)
- [Board admission](vapor/BOARDS.md)
- [Original experimental writeup](site/content/blog/pocket-vapor.md)
- [ESP32 setup](vapor/runtime/esp32/README.md) and [Playdate setup](vapor/runtime/playdate/README.md)

Extracted from [pocket-nexus/pocketjs at d3f0be0c7739ea704ca25d8b5158581bb176abc6](https://github.com/pocket-nexus/pocketjs/tree/d3f0be0c7739ea704ca25d8b5158581bb176abc6/vapor). Original source history remains there. The shared color palette and Vue JSX oracle adapter were made local during extraction. Source and maintained documentation media retain the original MIT license.
