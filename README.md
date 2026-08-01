# RF Web Simulator

RF Web Simulator is a local-first browser application for building and
simulating linear RF two-port chains. The project runs on GitHub Pages: no
backend, account, upload, or runtime other than a modern browser is required.

Online demo: <https://jorpago2.github.io/rf-web-simulator/>

## Current iteration: 0.3 scientific plots

- Vite, React, strict TypeScript, React Flow, and Zustand.
- Desktop/tablet RF editor with six draggable block types.
- Block selection, parameter editing, connection, and deletion.
- Local `.s2p` selection and validation; file contents never leave the browser.
- Touchstone 1.0 parser for `RI`, `MA`, and `DB`, with Hz/kHz/MHz/GHz units,
  arbitrary line wrapping, comments, and reference resistance.
- Validation of one connected, acyclic, non-branching source-to-load path.
- Common frequency grid over the intersection of every Touchstone network;
  real and imaginary parts are interpolated independently without extrapolation.
- Full two-port cascade with mismatch and internal reflections, common real
  reference-impedance enforcement, and near-singular warnings.
- Ideal amplifier and attenuator networks plus accumulated stage summaries.
- Typed Web Worker execution with transferable output buffers.
- Browser controls for range, points, reference impedance, and center-frequency
  S-parameter results.
- Interactive Plotly views for S11/S21/S12/S22 magnitude, unwrapped S21 phase,
  and S21 group delay, with zoom, pan, unified cursor, selectable frequency
  units, and SVG export.
- Colorblind-safe colors plus redundant line styles for S-parameter traces.
- Deterministic analytical and integration tests.
- CI and GitHub Pages deployment workflows.

IndexedDB project storage, JSON project files, and CSV export remain outside
this iteration.

## Run locally

Requirements: Node.js 22 or newer.

```bash
npm ci
npm run dev
```

Verification commands:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

## GitHub Pages

Pushes to `main` run CI and deploy `dist` through GitHub Actions. The repository
name is injected as Vite's base path, so assets work from project Pages URLs.

## Architecture

```text
src/
|-- app/       application shell, strings, and Zustand editor state
|-- diagram/   React Flow canvas, registry, and RF node rendering
|-- engine/    DOM-free validation, interpolation, cascade, and RF models
|-- plots/     lazily loaded Plotly scientific views
|-- test/      small deterministic scientific fixtures
`-- workers/   typed browser-worker boundary
```

Vector network data uses `Float64Array`. The Web Worker transfers output buffers
back to the UI instead of copying them. A future project JSON serializer must
convert typed arrays to an explicitly serializable representation.

Plotly is delivered as a separate basic-distribution chunk and is loaded only
after simulation results are displayed. Switching view or display units does
not rerun the RF engine.

## Touchstone assumptions and precision

- Only Touchstone 1.0 two-port S-parameter data is accepted.
- Data order is `frequency S11 S21 S12 S22`.
- Angles are interpreted in degrees and all frequencies are converted to Hz.
- Frequencies must be finite and strictly increasing.
- `RI`, `MA`, and `DB` are converted to Cartesian double-precision values.
- When the option line is absent, the Touchstone 1.0 defaults `GHz S MA R 50`
  are used.
- Touchstone 2.0, non-S parameters, noise data, and networks other than two
  ports are rejected.

## Cascade model

For network A followed by B, both referenced to the same real `Z0`, the engine
uses the two-port Redheffer star product. Its internal denominator is
`D = 1 - S22_A S11_B`; for example,
`S21_total = S21_B S21_A / D`. This preserves mismatch and multiple-reflection
effects that a sum of S21 values in dB would miss.

If `|D| < 1e-12`, the denominator magnitude is regularized to that tolerance and
a frequency-specific warning is returned. Different reference impedances are
rejected; silent renormalization is intentionally not implemented.

## Phase and group delay

S21 phase is unwrapped in radians. Group delay is evaluated as
`tau_g = -d(phi)/d(omega)` using central differences on interior points and
one-sided differences at the endpoints; nonuniform frequency grids are
supported. Values are stored in seconds and displayed in nanoseconds.

Zero magnitudes are plotted at a configurable numerical floor of -300 dB. S21
phase and group delay are marked as gaps, with an explicit warning, when
`|S21| <= 1e-15`. Phase unwrapping assumes adjacent valid samples differ by less
than pi radians after wrapping; a denser frequency grid is required when that
sampling condition is not met.

> S-parameters describe linear small-signal behavior. On their own they cannot
> determine P1dB, saturation, AM/AM, AM/PM, or intermodulation products.

## Roadmap

1. IndexedDB autosave, versioned JSON projects, and CSV export.
2. Accumulated full-frequency curves at probes.
3. RF budget, mixer behavior, and PWA support only after MVP stability.

## Privacy and security

All selected files and calculations remain on the device. The MVP includes no
analytics, telemetry, remote database, authentication, or upload endpoint.
Imported text is parsed as data and never executed.

## Citation

If you use this software in a scientific publication, please cite the exact version used. Citation metadata are provided in [`CITATION.cff`](CITATION.cff); GitHub's **Cite this repository** menu exports them in BibTeX and APA formats.

## License

[MIT](LICENSE). Direct runtime dependencies used in this iteration are MIT
licensed; transitive dependency licenses should be rechecked whenever the
dependency set changes.
