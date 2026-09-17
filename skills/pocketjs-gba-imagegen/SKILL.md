---
name: pocketjs-gba-imagegen
description: Generate original GBA-friendly pixel-art asset source sheets through Codex app-server and ImageGen, then save PNGs for experimental native asset baking. Use when a local coding agent needs reusable tiles, 16x16 character sprites, RPG item icons, or generic Game Boy Advance-style pixel art through the shared Codex image generation path.
---

# Pocket Vapor GBA ImageGen

## Overview

Use this skill when a Pocket Vapor or local Codex agent needs GBA-class pixel-art source images without hand-driving the built-in ImageGen tool. The standard entrypoint is `bun run gba:imagegen`; it starts a temporary Codex app-server on localhost, sends a single ImageGen turn, captures the `image_generation` result from the app-server event stream, and writes the PNG requested by `--out`.

The prompt is intentionally generic to the platform category. It must not ask for a specific existing game, franchise, creature, character, logo, or visual style clone.

## Standard Workflow

1. Confirm the target branch and local changes:

```text
git status --short --branch
```

2. Generate a source sheet with the Bun TypeScript CLI:

```text
bun run gba:imagegen --out dist/imagegen/gba-source.png
```

3. Add an art-direction seed only when the user asks for one:

```text
bun run gba:imagegen --out dist/imagegen/rainy-port-source.png --theme "rainy port town with stone quays and lanterns"
```

4. Use `--json` when another coding agent needs machine-readable output:

```text
bun run gba:imagegen --out /tmp/gba-sheet.png --json
```

5. This repository has no bitmap-to-cartridge asset extractor. Add an explicit
conversion step in the consuming application before using generated PNGs as
native cartridge data.

## Prompt Profiles

Use `--kind sprite-sheet` for the default mixed source sheet: terrain cells plus one generic four-direction walking character.

Use `--kind tileset` for top-down background terrain and props.

Use `--kind character` for one 16x16-style walking sprite with down/up/left/right facings and two walk frames per facing.

Use `--kind items` for small RPG item icons that remain readable as 16x16 sprites.

## Constraints

- Keep all command wrappers in Bun TypeScript. Do not add native shell scripts for this workflow.
- Generate original assets only; avoid franchise terms and existing character references.
- Keep the output as a source sheet on a neutral background with gutters so later scripts can crop or quantize it.
- Treat the generated PNG as source art. The AOT runtime still requires deterministic 4bpp extraction before the image can ship as cartridge data.
