# Repository instructions

- This is an early experiment, not a PocketJS mainline feature. Keep that status explicit in documentation.
- Use Conventional Commits for commits and PR titles.
- App incremental input uses `RelativeAxis`/`onAxisDelta` in `vapor/host/input.ts`; device adapters own SDK input concepts.
- Keep transient validation output under ignored `.pocket-build/validation/` or `dist/`. Commit media only for maintained tests or documentation.
- Run `bun run typecheck` and `bun run test:core`; run console parity when the required toolchains are available.
