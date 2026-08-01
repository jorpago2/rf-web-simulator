# RF Web Simulator

RF Web Simulator is a local-first browser application for building and
simulating linear RF two-port chains. The project runs on GitHub Pages: no
backend, account, upload, or runtime other than a modern browser is required.

Online demo: <https://jorpago2.github.io/rf-web-simulator/>

## Current iteration: 0.9 mixer spur planning

- Vite, React, strict TypeScript, React Flow, and Zustand.
- Desktop/tablet RF editor with seven draggable block types.
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
- Debounced IndexedDB autosave and reopening of recent local projects.
- Versioned JSON import/export with bounded schema validation at the file boundary.
- CSV export of the full simulated frequency sweep, including S-parameter
  magnitudes, S21 phase, and S21 group delay.
- Full-frequency accumulated S21 traces at every non-invasive Probe block,
  transferred from the worker and included in CSV exports.
- Center-frequency matched RF budget with signal power, Friis noise figure,
  conservative cascaded P1dB, and reciprocal cascaded IP3 bookkeeping.
- Ideal mixer with sum/difference conversion, explicit LO, conversion loss,
  frequency-plan table, conversion-envelope plot, and output-frequency CSV data.
- Touchstone stages after mixers evaluated on their translated local-frequency
  grids, with the corresponding input sweep clipped rather than extrapolated.
- Center-frequency image, LO leakage, and mixing-product plan through total
  order 3, with optional user-supplied rejection and isolation metadata.
- Deterministic analytical and integration tests.
- CI and GitHub Pages deployment workflows.

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
|-- persistence/ local IndexedDB, versioned project JSON, and CSV export
|-- plots/     lazily loaded Plotly scientific views
|-- test/      small deterministic scientific fixtures
`-- workers/   typed browser-worker boundary
```

Vector network data uses `Float64Array`. The Web Worker transfers output buffers
back to the UI instead of copying them. Project files store imported Touchstone
text as data so a saved project remains self-contained.

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

## Probe model

A Probe is an ideal, non-invasive marker in the linear chain. Its trace is the
S21 magnitude of the cascaded prefix from the source to that reference plane,
with the probe plane terminated in the analysis reference impedance `Z0`.
Therefore it is a cumulative two-port transfer function, not an internal
voltage or available-power measurement with downstream mismatch included.

## RF budget model

The RF budget is evaluated at the center of the simulated frequency grid as a
matched, unilateral available-power cascade. Stage power gain is `|S21|^2`.
Noise factor uses Friis' formula in linear units,
`F = F1 + (F2 - 1)/G1 + ...`. An ideal attenuator at 290 K has noise figure
equal to its loss in dB and no modeled compression or intermodulation limit.

Cascaded input IP3 uses
`1/IIP3 = 1/IIP3_1 + G1/IIP3_2 + G1*G2/IIP3_3 + ...` in linear power units.
P1dB uses the conservative first-stage-to-compress approximation: each stage's
output P1dB is referred to the chain input and the minimum is retained. These
are engineering estimates, not a nonlinear harmonic-balance simulation.

Amplifiers and Touchstone blocks accept independent NF, output P1dB, and output
IP3 metadata. Touchstone S2P data alone do not contain those quantities; missing
metadata remain visibly unavailable rather than being inferred. The small-signal
S-parameter cascade continues to include mismatch, while the budget does not.

## Mixer and frequency-plan model

An ideal Mixer retains one selected product. Difference conversion uses
`f_out = f_in - f_LO` and requires the complete input sweep to remain above the
LO; sum conversion uses `f_out = f_in + f_LO`. Conversion loss contributes to
the magnitude envelope and the matched RF budget. The frequency-plan view tracks
the input, LO, and output ranges through multiple mixers.

The conversion curve is plotted against RF input frequency, while CSV adds the
corresponding `output_frequency_hz` sample. This is not a conventional same-
frequency two-port S matrix: conversion phase and group delay are left undefined.
A Touchstone stage after a mixer is interpolated at its translated local
frequency while results remain indexed by the RF input sweep. This is a
selected-product envelope, not a frequency-converting multiport S matrix.

At the sweep center, the planner reports products `|m f_in + n f_LO|` through
total order `|m| + |n| = 3`. For difference conversion, the alternate image
input is `2 f_LO - f_in` when positive; for sum conversion, the image output
sideband is `|f_LO - f_in|`. Image rejection and LO-to-output isolation are
optional user metadata. Estimated LO leakage power is `P_LO - isolation` only
when both values are supplied. Other spur amplitudes are intentionally left
unavailable because they require measured or vendor-specific conversion data.

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

> S-parameters describe linear small-signal behavior. Budget P1dB and IP3 values
> come from independent block metadata; they are not inferred from S2P data.

## Roadmap

1. PWA/offline installation only if classroom use demonstrates a need.

## Project files and local storage

Project JSON files use schema version 2 and include the diagram, analysis
settings, block parameters, and selected Touchstone text. Schema 1 files are
migrated on import. Imports reject unknown schema versions, invalid graph
references, non-finite numbers, unsafe object keys, excessive nesting, files
above 20 MiB, and projects above 20 nodes or 40 edges. IndexedDB keeps recent
projects in the current browser profile; JSON export is the portable backup.

CSV uses comma-separated columns with input/output frequencies and group delay
in SI units (`Hz` and `s`). Each Probe adds an accumulated-S21 column identified
by label and node ID. Undefined conversion phase or delay samples are written as
empty fields.

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
