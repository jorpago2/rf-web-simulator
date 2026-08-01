# RF Web Simulator

Local-first RF system simulator for teaching, early architecture work, and
reproducible analysis in a browser. Projects, Touchstone files, and measured CSV
tables remain local; no backend or account is required.

Online demo: <https://jorpago2.github.io/rf-web-simulator/>

## Implemented analyses

- Directed acyclic RF graphs with coherent split/recombine paths, ideal
  splitters/combiners, Butterworth LP/HP/BP/BS filters, phase shifters,
  isolators, RF switches, directional couplers, LP/HP diplexers, probes, and
  arbitrary imported N-port blocks. Analog-system blocks also include matched
  transmission lines, finite-Q L/π/T networks, 1:1 baluns, separate TX/RX
  antenna terminals, and a voltage-tuned oscillator/VCO source.
- General N-port connection solver including mismatch, multiple reflections,
  isolation, and coherent branch phase.
- Touchstone 1.0 and 2.0 `.sNp` import (`S`, `Z`, `Y`, `H`, and `G`; `RI`, `MA`,
  and `DB`; full/lower/upper matrices; per-port real references; mixed-mode
  ordering metadata; two-port noise parameters).
- Automatic real-reference renormalization, optional two-fixture de-embedding,
  and S/Z/Y/ABCD conversion.
- S-parameter, Smith, phase, group-delay, and stability views; Rollett K,
  source/load μ, maximum singular value for passivity, reciprocity error, and a
  band-limited negative-time-energy causality diagnostic. Imported data can use
  opt-in conservative passivity enforcement with an explicit distortion warning.
- Exact center-frequency transducer gain and delivered power for real source and
  load impedances. Per-stage signal gains include mismatch and internal
  reflections.
- Correlated noise-wave propagation through serial or branched N-port graphs.
  Touchstone `Fmin`, `GammaOpt`, and `Rn` are converted to a full two-port noise
  correlation matrix; passive blocks use the Bosma relation `C/kT = I-SS^H`.
- P1dB-calibrated compression, measured `Pout(Pin)` and AM/PM interpolation,
  phase-coherent third-order contributions from per-stage OIP3 metadata, and a
  sampled multitone complex-envelope spectrum with higher odd-order sidebands.
- Mixer sum/difference envelope simulation plus measured arbitrary
  `|m fIN + n fLO|` product tables. Declared product power and phase propagate
  through later mixers. Branched conversion paths may recombine when their
  translated bands coincide.
- Reproducible Gaussian Monte Carlo tolerances with percentiles, ranked Pearson
  sensitivity correlations, and constraint-based yield.
- Bounded one- or two-variable grid optimization (at most 1,000 combinations)
  with a physical feasibility constraint. Objectives include S21, delivered
  power, input P1dB, and correlated cascaded noise figure.
- IndexedDB autosave, versioned self-contained JSON projects, CSV export, Web
  Worker execution, and transferable numerical buffers.
- Editable built-in templates for a 2.4 GHz carrier transmitter, a 915 MHz to
  70 MHz superheterodyne receiver, and a 2.45 GHz to 20 MHz low-IF receiver.

## Run and verify

Requires Node.js 22 or newer.

```bash
npm ci
npm run dev
```

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

## Numerical models

### Linear graph

Every block contributes an S matrix. The solver forms the block-diagonal global
matrix and eliminates connected internal ports, leaving the source and load
ports. This is equivalent to a generalized Redheffer connection and retains
internal reflections. Acyclic directed connectivity is required; every declared
port must have exactly one valid connection.

Imported networks are interpolated in Cartesian form on the common frequency
intersection; extrapolation is rejected. Calculations use `Float64Array`.
Touchstone references are renormalized to the real analysis impedance. Complex
or frequency-dependent reference impedances are not supported.

The causality indicator reconstructs a band-limited S21 impulse response on a
uniform grid and reports negative-time energy relative to total energy. It is a
diagnostic whose time resolution is displayed, not a mathematical proof outside
the measured band. Optional passivity enforcement scales each non-passive S
matrix conservatively and reports every modified frequency point; pointwise
correction can itself change causality.

A mixer changes the local frequency coordinate. Signals meeting at a combiner
must have equal accumulated frequency translation; otherwise the graph is
rejected because coherent recombination would be undefined.

The RF switch is a matched reciprocal ON/OFF two-port. The directional coupler
is a passive reduced three-port with an internally terminated isolated port;
its through and sampled powers include the configured excess loss and a 90Â°
coupled-path phase. The diplexer is a matched reciprocal three-port built from
complementary equal-order Butterworth low- and high-pass responses. These are
system-level models, not distributed-geometry or electromagnetic simulations.

Transmission lines use the `exp(-j2πfτ)` convention with a constant matched
insertion loss. Lumped matching blocks cascade series and shunt L/C ABCD
matrices; π and T forms are symmetric, and a shared component Q introduces
series loss. The 1:1 balun is a reduced three-port with configurable excess
loss, amplitude imbalance, phase error from 180°, and output isolation.

The VCO frequency is `f = f0 + Kv Vcontrol`; it drives the frequency plan, and
the nearest point in the global analysis sweep is used for budgets. Free-running
SSB phase noise uses a configurable value at 1 MHz, logarithmic slope, and noise
floor. The optional PLL combines the VCO and a declared in-band output-noise
level with complementary first-order power responses. RMS phase error integrates
`2 integral 10^(L(f)/10) df` over the displayed offset limits, and time jitter is
derived from the carrier frequency. This behavioral model excludes reference
spurs, divider/charge-pump noise, pushing, pulling, harmonics, startup, lock
acquisition, and nonlinear loop dynamics.

The RX antenna supplies available received power and source impedance; the TX
antenna terminates the chain with a load impedance. An axisymmetric
cosine-power far-field model derives directivity from its exponent and
front-to-back ratio. Efficiency then gives realized gain, effective aperture,
radiated power, and EIRP. The plotted angular cut is normalized and clipped at
-60 dB. Polarization, impedance mismatch beyond the circuit load, mutual
coupling, propagation loss, near fields, and geometry-dependent 3D EM behavior
are not modeled.

### Power and noise budget

The final transducer gain uses the complete two-port and the selected real
source/load impedances, including `S11`, `S12`, `S21`, `S22`, and feedback. The
per-stage table uses differences between successive prefix transducer gains; the
last stage also includes the configured load mismatch so its cumulative output
equals delivered load power.

Touchstone two-port noise data use

`F = Fmin + 4 Rn/Z0 |GammaS-GammaOpt|^2 / ((1-|GammaS|^2)|1+GammaOpt|^2)`.

The solver eliminates internal noise waves with the same connection equations
used for signal waves, then applies the selected source/load terminations to the
effective external correlation matrix. This retains noise correlation,
reflection, splitting, and coherent recombination. Passive networks are assumed
at the reference temperature (290 K). An active N-port without Touchstone noise
data or declared NF remains unavailable rather than being treated as noiseless.

### Nonlinear behavior

Analytical compression uses a smooth law calibrated exactly at the supplied
OP1dB. A measured device CSV can instead provide frequency-dependent gain, NF,
OP1dB, OIP3, `Pout(Pin)`, and output phase; interpolation is limited to its
measured domain.

Third-order output terms are extrapolated from each stage OIP3. Their complex
amplitudes are summed using the configurable per-stage IM3 contribution phase,
so reinforcement and cancellation are represented. This is a memoryless
third-order behavioral/Volterra model, not transistor-level harmonic balance.
It does not predict even-order carrier harmonics, bias or thermal dynamics,
memory, load-pull, oscillation, or device waveforms. Separately, the
quasi-static complex-envelope sampler applies the configured AM/AM–AM/PM law to
a two-tone waveform and Fourier-analyzes odd intermodulation sidebands through
order 15. It is a behavioral spectral-balance result, not a transistor circuit
solution.

### Mixers

The selected conversion product defines the chain envelope and local frequency
grid. Optional CSV rows use:

```text
m,n,relative_level_db,phase_deg,label
1,-1,-7,12,Desired IF
2,-1,-42,-30,2RF-LO
```

Every declared input-dependent product is propagated through subsequent mixer
tables. LO leakage is added from LO power minus isolation when both are known.
Undeclared spur amplitudes are left unavailable; they are never invented from
frequency order alone. At most 512 strongest conversion paths are retained to
bound combinatorial growth.

### Tolerances and optimization

Tolerance fields are independent one-sigma Gaussian variables. Monte Carlo is
deterministic for a fixed 32-bit seed and is limited to 500 runs. Reported P05,
P50, P95, mean, sample standard deviation, and Pearson correlations are
statistical estimates; correlated manufacturing variables require a measured
joint model and are not inferred.

The optimizer is an explicit one- or two-dimensional grid search. It rejects
samples that fail the configured minimum/maximum constraint and reports the
best feasible sampled point. It makes no claim of a continuous or global
optimum; discrete choices or more than two coupled variables still require an
external optimizer.

## Measured amplifier CSV

The header accepts `frequency_hz`, `frequency_mhz`, or `frequency_ghz`, plus any
of `gain_db`, `noise_figure_db`/`nf_db`, `output_p1dbm`/`op1dbm`,
`output_ip3_dbm`/`oip3_dbm`, and paired `input_power_dbm`, `output_power_dbm`,
`output_phase_deg`/`ampm_deg` columns. Blank cells are allowed. See
[`public/examples/device-performance-template.csv`](public/examples/device-performance-template.csv).

## Scope boundary

The application now covers the high-impact RF system analyses that can be
performed reproducibly from S-parameters and behavioral metadata. It is not a
replacement for ADS/AWR circuit synthesis, SPICE device models, EM field
solvers, nonlinear harmonic balance, load-pull/X-parameters, layout/PDK flows,
or instrument calibration. Those require device equations or field geometry
that this block-level project does not contain.

## Architecture

```text
src/
|-- app/          application shell and Zustand editor state
|-- diagram/      React Flow graph editor and RF block ports
|-- engine/       parsers, graph validation, RF models, and numerical solvers
|-- persistence/  IndexedDB, project JSON, and CSV export
|-- plots/        lazily loaded Plotly scientific views
`-- workers/      typed browser-worker boundary
```

Pushes to `main` run CI and deploy `dist` through GitHub Actions.
