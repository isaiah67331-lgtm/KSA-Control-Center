# Contributing

Use Node.js 22 or newer and run `npm ci`, `npm run check`, and `npm test` before opening a pull request. Run `npm run test:ui` when changing the interface. Build on Linux and Windows before claiming support for a new release.

## Project map

- `src/main.js`: Electron window, narrow IPC actions, process control, settings.
- `src/core.js`: mod archives, transactional installs, manifests, downloads.
- `src/preload.js`: the renderer's explicitly allowed actions.
- `src/renderer.js`: interface behavior; dynamic text uses DOM textContent.
- `src/styles.css`: warm neutral design with orange accents.
- `src/catalog.json`: reviewed release metadata.
- `assets/orbits.svg`: original decorative artwork.
- `test/`: file-operation tests and isolated Electron UI checks.

## Adding a mod

Find the author's own repository. Check the license, README, release notes, required loader/dependencies, and target KSA build. Add the exact release tag and ZIP asset name; never substitute a GitHub source-code ZIP for a compiled release.

List required mods in `dependencies`, overlapping mods in `conflicts`, and build caveats in `compatibility`. Explain optional dependencies without treating them as mandatory. Check that the archive has exactly one `mod.toml` and that the catalog ID is the ID used in KSA's manifest.

Do not bundle mod binaries, game assemblies, saves, screenshots from third parties without permission, authentication tokens, or absolute personal paths. Dependencies remain separate projects.

## Security boundaries

Keep context isolation and renderer sandboxing enabled. Never expose Node.js or arbitrary file/command access to the renderer. External source links are selected by catalog ID in the main process. Treat downloaded archive paths and mod metadata as untrusted.

Use `KSA_TEST_HOME` only for automated tests. Never run file-operation tests against a real game directory.

