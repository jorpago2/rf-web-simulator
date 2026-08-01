# RF Web Simulator

RF Web Simulator is a local-first browser application for building and, in
later MVP iterations, simulating linear RF two-port chains. The project targets
GitHub Pages: no backend, account, upload, or runtime other than a modern web
browser is required.

## Current iteration: 0.1 foundation

- Vite, React, strict TypeScript, React Flow, and Zustand project shell.
- Desktop/tablet RF editor with six draggable block types.
- Block selection, parameter editing, connection, and deletion.
- Local `.s2p` selection and validation; file contents never leave the browser.
- Touchstone 1.0 parser for `RI`, `MA`, and `DB`, with Hz/kHz/MHz/GHz units,
  arbitrary line wrapping, comments, and reference resistance.
- Pure complex-number operations backed by unit tests.
- Synthetic ideal-through fixtures for tests and manual use.
- CI and GitHub Pages deployment workflows.

The numerical cascade, graph validation, Web Worker, plots, IndexedDB project
storage, JSON project files, and CSV export are intentionally not part of this
first iteration.

## Run locally

Requirements: Node.js 22 or newer.

```bash
npm ci
npm run dev
```

Then open the local URL printed by Vite. Verification commands:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

## GitHub Pages

Push to `main`, then select **GitHub Actions** as the Pages source in the
repository settings. `.github/workflows/deploy-pages.yml` tests, builds, and
deploys `dist`. The repository name is injected as Vite's base path, so assets
also work from project Pages URLs.

Online demo: <https://jorpago2.github.io/rf-web-simulator/>

## Architecture

```text
src/
├── app/          application shell, strings, and Zustand editor state
├── diagram/      React Flow canvas, registry, and RF node rendering
├── engine/       DOM-free RF domain types, complex math, and Touchstone parser
└── test/         small deterministic scientific fixtures
```

The RF engine imports neither React nor browser DOM APIs. Vector network data
uses `Float64Array`; a future project JSON serializer must convert those values
to an explicitly serializable representation.

## Touchstone assumptions and precision

- Only Touchstone 1.0 two-port S-parameter data is accepted.
- Data order is `frequency S11 S21 S12 S22`.
- Angles are interpreted in degrees and all frequencies are converted to Hz.
- Frequencies must be finite and strictly increasing.
- `RI`, `MA`, and `DB` are converted to Cartesian double-precision values.
- When the option line is absent, the Touchstone 1.0 defaults `GHz S MA R 50`
  are used.
- Touchstone 2.0, non-S parameters, noise data, and networks other than two
  ports are rejected or remain outside this iteration.

> S-parameters describe linear small-signal behavior. On their own they cannot
> determine P1dB, saturation, AM/AM, AM/PM, or intermodulation products.

## Roadmap

1. Interpolation on the common frequency intersection and validated linear
   graph ordering.
2. Numerically guarded two-port cascade and accumulated probe results.
3. Typed Web Worker requests and transfer of large array buffers.
4. S-parameter, phase, and group-delay plots.
5. IndexedDB autosave, versioned JSON projects, and CSV export.
6. RF budget, mixer behavior, and PWA support only after MVP stability.

## Privacy and security

All selected files and calculations remain on the device. The MVP includes no
analytics, telemetry, remote database, authentication, or upload endpoint.
Imported text is parsed as data and never executed.

## License

[MIT](LICENSE). Direct runtime dependencies used in this iteration are MIT
licensed; transitive dependency licenses should be rechecked whenever the
dependency set changes.
