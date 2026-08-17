import { IconButton } from '@carbon/react'
import { Download, Reset } from '@carbon/icons-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Config, Data, Layout } from 'plotly.js'
import {
  SCIENTIFIC_PLOT_LINE_WIDTHS,
  createScientificPlotlyAxis,
  createScientificPlotlyConfig,
  createScientificPlotlyLayout,
  useScientificPlotTheme,
} from '@jorpago2/scientific-ui'
import type { SimulationOutput } from '../engine/types'

export type PlotView =
  | 'sParameters'
  | 'smith'
  | 'stability'
  | 'phase'
  | 'groupDelay'
  | 'probes'
  | 'nonlinear'
  | 'oscillator'
  | 'antenna'
export type FrequencyUnit = 'auto' | 'Hz' | 'kHz' | 'MHz' | 'GHz'

const TRACE_STYLES = [
  { color: '#0072b2', dash: 'solid' },
  { color: '#d55e00', dash: 'dash' },
  { color: '#009e73', dash: 'dot' },
  { color: '#cc79a7', dash: 'dashdot' },
] as const

const PROBE_COLORS = [
  '#0072b2',
  '#d55e00',
  '#009e73',
  '#cc79a7',
  '#e69f00',
  '#56b4e9',
  '#8a3ffc',
  '#7b61a8',
] as const
const PROBE_DASHES = ['solid', 'dash', 'dot', 'dashdot'] as const

export function RFPlot({
  result,
  view,
  frequencyUnit,
}: {
  result: SimulationOutput
  view: PlotView
  frequencyUnit: FrequencyUnit
}) {
  const resolvedUnit = resolveFrequencyUnit(
    frequencyUnit,
    result.total.frequencyHz.at(-1)!,
  )
  const scale = frequencyScale(resolvedUnit)
  const frequency = useMemo(
    () => [...result.total.frequencyHz].map((value) => value / scale),
    [result, scale],
  )
  const figure = useMemo(
    () => createFigure(result, view, resolvedUnit, frequency),
    [frequency, resolvedUnit, result, view],
  )
  const frequencyConverting =
    result.frequencyPlan.stages.length > 0 ||
    result.frequencyPlan.output.centerHz !== result.frequencyPlan.input.centerHz
  const exportFileName = `rf-${view}`
  const config = useMemo(
    () =>
      createScientificPlotlyConfig({
        filename: exportFileName,
        scrollZoom: true,
        displayModeBar: false,
        addFullscreen: false,
      }) as Partial<Config>,
    [exportFileName],
  )

  return (
    <PlotlyFigure
      ariaLabel={
        view === 'nonlinear'
          ? 'Nonlinear transfer and IM3 versus per-tone input power'
          : view === 'oscillator'
            ? 'Single-sideband oscillator phase noise versus offset frequency'
            : view === 'antenna'
              ? 'Normalized antenna radiation pattern versus angle'
              : `${plotTitle(view, frequencyConverting)} versus frequency`
      }
      config={config}
      data={figure.data}
      description={plotSummary(result, view, frequencyConverting)}
      exportFileName={exportFileName}
      layout={figure.layout}
    />
  )
}

function PlotlyFigure({
  data,
  layout,
  config,
  ariaLabel,
  description,
  exportFileName,
}: {
  data: Data[]
  layout: Partial<Layout>
  config: Partial<Config>
  ariaLabel: string
  description: string
  exportFileName: string
}) {
  const plotRef = useRef<HTMLDivElement>(null)
  const descriptionId = `rf-plot-description-${useId().replace(/:/g, '')}`
  const plotlyRef = useRef<
    typeof import('plotly.js-basic-dist-min').default | null
  >(null)
  const [plotReady, setPlotReady] = useState(false)
  const plotTheme = useScientificPlotTheme()

  const resetView = useCallback(() => {
    const element = plotRef.current
    const plotly = plotlyRef.current
    if (!element || !plotly) return
    const resetLayout: Record<string, unknown> = {}
    for (const axisName of ['xaxis', 'yaxis', 'yaxis2'] as const) {
      const configuredAxis = layout[axisName]
      if (!configuredAxis && axisName === 'yaxis2') continue
      const range = configuredAxis?.range
      if (Array.isArray(range)) resetLayout[`${axisName}.range`] = range
      else resetLayout[`${axisName}.autorange`] = true
    }
    void plotly.relayout(element, resetLayout)
  }, [layout])

  const downloadPlot = useCallback(() => {
    const element = plotRef.current
    const plotly = plotlyRef.current
    if (!element || !plotly) return
    void plotly.downloadImage(element, {
      format: 'svg',
      filename: exportFileName,
      width: 1400,
      height: 800,
    })
  }, [exportFileName])

  useEffect(() => {
    const element = plotRef.current
    if (!element) return
    let cancelled = false
    let plotly: typeof import('plotly.js-basic-dist-min').default | undefined

    setPlotReady(false)
    void import('plotly.js-basic-dist-min')
      .then((module) => {
        if (cancelled) return
        plotly = module.default
        plotlyRef.current = plotly
        const normalizedLayout = createScientificPlotlyLayout({
          height: typeof layout.height === 'number' ? layout.height : 330,
          theme: plotTheme,
          overrides: layout as Record<string, unknown>,
        }) as Partial<Layout>
        if (normalizedLayout.yaxis2) {
          normalizedLayout.yaxis2 = createScientificPlotlyAxis(
            plotTheme,
            undefined,
            normalizedLayout.yaxis2 as Record<string, unknown>,
          ) as Layout['yaxis2']
        }
        return plotly
          .react(element, data, normalizedLayout, config)
          .then(() => {
            if (!cancelled) setPlotReady(true)
          })
      })
      .catch(() => {
        if (!cancelled) {
          plotlyRef.current = null
          setPlotReady(false)
        }
      })

    return () => {
      cancelled = true
      plotlyRef.current = null
      if (plotly) plotly.purge(element)
    }
  }, [config, data, layout, plotTheme])

  return (
    <div className="rf-plot-frame">
      <p id={descriptionId} className="scientific-visually-hidden">
        {description}
      </p>
      <div
        className="rf-plot scientific-plot-surface"
        ref={plotRef}
        role="img"
        aria-label={ariaLabel}
        aria-describedby={descriptionId}
      />
      <div
        className="rf-plot-actions"
        role="toolbar"
        aria-label="Plot controls"
      >
        <IconButton
          align="top-right"
          disabled={!plotReady}
          kind="ghost"
          label="Reset plot view"
          size="sm"
          type="button"
          onClick={resetView}
        >
          <Reset />
        </IconButton>
        <IconButton
          align="top-right"
          disabled={!plotReady}
          kind="ghost"
          label="Download plot as SVG"
          size="sm"
          type="button"
          onClick={downloadPlot}
        >
          <Download />
        </IconButton>
      </div>
    </div>
  )
}

function plotSummary(
  result: SimulationOutput,
  view: PlotView,
  frequencyConverting: boolean,
): string {
  const frequencySamples = result.total.frequencyHz.length
  const firstFrequency = result.total.frequencyHz[0]
  const lastFrequency = result.total.frequencyHz.at(-1)
  const frequencyRange = `${formatPlotValue(firstFrequency)} to ${formatPlotValue(lastFrequency)} Hz`

  if (view === 'nonlinear') {
    const nonlinear = result.nonlinear
    return [
      `Nonlinear sweep with ${nonlinear.inputPowerDbm.length} input-power points.`,
      `Input range ${formatPlotValue(nonlinear.inputPowerDbm[0])} to ${formatPlotValue(nonlinear.inputPowerDbm.at(-1))} dBm.`,
      nonlinear.outputP1Dbm === null
        ? 'The compressed P1dB result is unavailable.'
        : `Output P1dB is ${formatPlotValue(nonlinear.outputP1Dbm)} dBm.`,
      nonlinear.outputIp3Dbm === null
        ? 'The output IP3 result is unavailable.'
        : `Output IP3 is ${formatPlotValue(nonlinear.outputIp3Dbm)} dBm.`,
    ].join(' ')
  }

  if (view === 'oscillator') {
    const noise = result.oscillatorNoise
    if (!noise.available || noise.offsetFrequencyHz.length === 0) {
      return 'Oscillator phase-noise data are unavailable for this result.'
    }
    return [
      `Oscillator phase-noise sweep with ${noise.offsetFrequencyHz.length} offset-frequency points.`,
      `Offset range ${formatPlotValue(noise.offsetFrequencyHz[0])} to ${formatPlotValue(noise.offsetFrequencyHz.at(-1))} Hz.`,
      `Free-running phase noise changes from ${formatPlotValue(noise.freeRunningDbcHz[0])} to ${formatPlotValue(noise.freeRunningDbcHz.at(-1))} dBc/Hz.`,
      noise.pllEnabled
        ? `PLL output phase noise changes from ${formatPlotValue(noise.outputDbcHz[0])} to ${formatPlotValue(noise.outputDbcHz.at(-1))} dBc/Hz.`
        : 'No PLL output trace is present.',
    ].join(' ')
  }

  if (view === 'antenna') {
    const antenna = result.antenna
    if (!antenna.available || antenna.angleDeg.length === 0) {
      return 'Antenna radiation-pattern data are unavailable for this result.'
    }
    return [
      `Normalized antenna radiation cut with ${antenna.angleDeg.length} angle samples.`,
      `Angle range ${formatPlotValue(antenna.angleDeg[0])} to ${formatPlotValue(antenna.angleDeg.at(-1))} degrees.`,
      `Efficiency is ${formatPlotValue(antenna.efficiencyPercent)} percent and realized gain is ${formatPlotValue(antenna.realizedGainDbi)} dBi.`,
    ].join(' ')
  }

  if (view === 'smith') {
    return [
      `S11 Smith chart with ${frequencySamples} frequency samples over ${frequencyRange}.`,
      `The reflection coefficient moves from ${formatComplex(result.total.s11.re[0], result.total.s11.im[0])} to ${formatComplex(result.total.s11.re.at(-1), result.total.s11.im.at(-1))}.`,
    ].join(' ')
  }

  if (view === 'stability') {
    return [
      `Stability and passivity checks over ${frequencySamples} frequency samples from ${frequencyRange}.`,
      `At the first sample, K is ${formatPlotValue(result.networkChecks.stabilityK[0])} and the maximum singular value is ${formatPlotValue(result.networkChecks.passivityMaximumSingularValue[0])}.`,
      `At the last sample, K is ${formatPlotValue(result.networkChecks.stabilityK.at(-1))} and the maximum singular value is ${formatPlotValue(result.networkChecks.passivityMaximumSingularValue.at(-1))}.`,
    ].join(' ')
  }

  if (view === 'phase') {
    return [
      `Unwrapped S21 phase over ${frequencySamples} frequency samples from ${frequencyRange}.`,
      `Phase changes from ${formatPlotValue(result.curves.s21PhaseDeg[0])} to ${formatPlotValue(result.curves.s21PhaseDeg.at(-1))} degrees.`,
    ].join(' ')
  }

  if (view === 'groupDelay') {
    return [
      `S21 group delay over ${frequencySamples} frequency samples from ${frequencyRange}.`,
      `Group delay changes from ${formatPlotValue((result.curves.s21GroupDelayS[0] ?? Number.NaN) * 1e9)} to ${formatPlotValue((result.curves.s21GroupDelayS.at(-1) ?? Number.NaN) * 1e9)} nanoseconds.`,
    ].join(' ')
  }

  if (view === 'probes') {
    const firstProbe = result.probeResults[0]
    if (!firstProbe)
      return `No probe traces are available across ${frequencySamples} frequency samples.`
    return [
      `${result.probeResults.length} probe traces over ${frequencySamples} frequency samples from ${frequencyRange}.`,
      `${firstProbe.label} changes from ${formatPlotValue(firstProbe.s21Db[0])} to ${formatPlotValue(firstProbe.s21Db.at(-1))} dB.`,
    ].join(' ')
  }

  const traceLabel = frequencyConverting
    ? 'Conversion gain'
    : 'S-parameter magnitude'
  return [
    `${traceLabel} over ${frequencySamples} frequency samples from ${frequencyRange}.`,
    `S21 changes from ${formatPlotValue(result.curves.s21Db[0])} to ${formatPlotValue(result.curves.s21Db.at(-1))} dB.`,
  ].join(' ')
}

function formatPlotValue(value: number | null | undefined): string {
  return value !== null && value !== undefined && Number.isFinite(value)
    ? value.toPrecision(6)
    : 'unavailable'
}

function formatComplex(
  real: number | undefined,
  imaginary: number | undefined,
): string {
  return `${formatPlotValue(real)} ${imaginary !== undefined && imaginary >= 0 ? '+' : ''}${formatPlotValue(imaginary)}j`
}

function createFigure(
  result: SimulationOutput,
  view: PlotView,
  unit: Exclude<FrequencyUnit, 'auto'>,
  frequency: number[],
): { data: Data[]; layout: Partial<Layout> } {
  if (view === 'nonlinear') return createNonlinearFigure(result)
  if (view === 'smith') return createSmithFigure(result)
  if (view === 'oscillator') return createOscillatorFigure(result)
  if (view === 'antenna') return createAntennaFigure(result)

  const commonLayout: Partial<Layout> = {
    autosize: true,
    height: 330,
    margin: { l: 68, r: 22, t: 32, b: 56 },
    font: {
      family: 'IBM Plex Sans, sans-serif',
      size: 11,
    },
    hovermode: 'x unified',
    uirevision: `${view}-${unit}`,
    xaxis: {
      title: { text: `Frequency (${unit})` },
      zeroline: false,
    },
    legend: {
      orientation: 'h',
      x: 0,
      y: 1.14,
    },
  }

  if (view === 'stability') {
    const traces = [
      ['K', result.networkChecks.stabilityK],
      ['μ<sub>source</sub>', result.networkChecks.stabilityMuSource],
      ['μ<sub>load</sub>', result.networkChecks.stabilityMuLoad],
      [
        'σ<sub>max</sub>(S)',
        result.networkChecks.passivityMaximumSingularValue,
      ],
    ] as const
    return {
      data: traces.map(([name, values], index) => ({
        type: 'scatter',
        mode: 'lines',
        name,
        x: frequency,
        y: Array.from(values, (value) =>
          Number.isFinite(value) ? value : null,
        ),
        line: {
          color: TRACE_STYLES[index]!.color,
          dash: TRACE_STYLES[index]!.dash,
          width: SCIENTIFIC_PLOT_LINE_WIDTHS.primary,
        },
        hovertemplate: `${name}: %{y:.4g}<extra></extra>`,
      })),
      layout: {
        ...commonLayout,
        yaxis: axis('Dimensionless metric'),
        shapes: [
          {
            type: 'line',
            xref: 'paper',
            x0: 0,
            x1: 1,
            y0: 1,
            y1: 1,
            line: {
              color: '#64748b',
              dash: 'dot',
              width: SCIENTIFIC_PLOT_LINE_WIDTHS.reference,
            },
          },
        ],
      },
    }
  }

  if (view === 'sParameters') {
    if (
      result.frequencyPlan.stages.length > 0 ||
      result.frequencyPlan.output.centerHz !==
        result.frequencyPlan.input.centerHz
    ) {
      return {
        data: [
          {
            type: 'scatter',
            mode: 'lines',
            name: 'Conversion gain',
            x: frequency,
            y: Array.from(result.curves.s21Db),
            line: {
              color: TRACE_STYLES[1].color,
              width: SCIENTIFIC_PLOT_LINE_WIDTHS.primary,
            },
            hovertemplate: 'Conversion gain: %{y:.3f} dB<extra></extra>',
          },
        ],
        layout: {
          ...commonLayout,
          showlegend: false,
          yaxis: axis('Conversion magnitude (dB)'),
        },
      }
    }
    const traces = [
      ['S<sub>11</sub>', result.curves.s11Db],
      ['S<sub>21</sub>', result.curves.s21Db],
      ['S<sub>12</sub>', result.curves.s12Db],
      ['S<sub>22</sub>', result.curves.s22Db],
    ] as const
    return {
      data: traces.map(([name, values], index) => ({
        type: 'scatter',
        mode: 'lines',
        name,
        x: frequency,
        y: Array.from(values),
        line: {
          color: TRACE_STYLES[index]!.color,
          dash: TRACE_STYLES[index]!.dash,
          width: SCIENTIFIC_PLOT_LINE_WIDTHS.primary,
        },
        hovertemplate: `${name}: %{y:.3f} dB<extra></extra>`,
      })),
      layout: {
        ...commonLayout,
        yaxis: axis('Magnitude (dB)'),
      },
    }
  }

  if (view === 'probes') {
    const conversion =
      result.frequencyPlan.stages.length > 0 ||
      result.frequencyPlan.output.centerHz !==
        result.frequencyPlan.input.centerHz
    return {
      data: result.probeResults.map((probe, index) => ({
        type: 'scatter',
        mode: 'lines',
        name: `${probe.label} (probe ${index + 1})`,
        x: frequency,
        y: Array.from(probe.s21Db),
        line: {
          ...probeTraceStyle(index),
          width: SCIENTIFIC_PLOT_LINE_WIDTHS.primary,
        },
        hovertemplate: `${conversion ? 'Accumulated conversion gain' : 'Accumulated S<sub>21</sub>'}: %{y:.3f} dB<extra>%{fullData.name}</extra>`,
      })),
      layout: {
        ...commonLayout,
        yaxis: axis(
          conversion
            ? 'Cumulative conversion magnitude (dB)'
            : 'Cumulative S<sub>21</sub> magnitude (dB)',
        ),
      },
    }
  }

  if (view === 'phase') {
    return {
      data: [
        {
          type: 'scatter',
          mode: 'lines',
          name: '∠S<sub>21</sub>',
          x: frequency,
          y: Array.from(result.curves.s21PhaseDeg),
          connectgaps: false,
          line: {
            color: TRACE_STYLES[0].color,
            width: SCIENTIFIC_PLOT_LINE_WIDTHS.primary,
          },
          hovertemplate: 'Phase: %{y:.3f}°<extra></extra>',
        },
      ],
      layout: {
        ...commonLayout,
        showlegend: false,
        yaxis: axis('Unwrapped phase of S<sub>21</sub> (°)'),
      },
    }
  }

  return {
    data: [
      {
        type: 'scatter',
        mode: 'lines',
        name: 'τ<sub>g</sub>(S<sub>21</sub>)',
        x: frequency,
        y: [...result.curves.s21GroupDelayS].map((value) => value * 1e9),
        connectgaps: false,
        line: {
          color: TRACE_STYLES[2].color,
          width: SCIENTIFIC_PLOT_LINE_WIDTHS.primary,
        },
        hovertemplate: 'Group delay: %{y:.4f} ns<extra></extra>',
      },
    ],
    layout: {
      ...commonLayout,
      showlegend: false,
      yaxis: axis('Group delay of S<sub>21</sub> (ns)'),
    },
  }
}

function createOscillatorFigure(result: SimulationOutput): {
  data: Data[]
  layout: Partial<Layout>
} {
  const noise = result.oscillatorNoise
  const data: Data[] = [
    {
      type: 'scatter',
      mode: 'lines',
      name: 'Free-running VCO',
      x: Array.from(noise.offsetFrequencyHz),
      y: Array.from(noise.freeRunningDbcHz),
      line: {
        color: TRACE_STYLES[1].color,
        dash: 'dash',
        width: SCIENTIFIC_PLOT_LINE_WIDTHS.primary,
      },
      hovertemplate: '%{x:.4g} Hz: %{y:.2f} dBc/Hz<extra>VCO</extra>',
    },
  ]
  if (noise.pllEnabled) {
    data.push({
      type: 'scatter',
      mode: 'lines',
      name: 'PLL output',
      x: Array.from(noise.offsetFrequencyHz),
      y: Array.from(noise.outputDbcHz),
      line: {
        color: TRACE_STYLES[0].color,
        width: SCIENTIFIC_PLOT_LINE_WIDTHS.emphasis,
      },
      hovertemplate: '%{x:.4g} Hz: %{y:.2f} dBc/Hz<extra>PLL output</extra>',
    })
  }
  return {
    data,
    layout: {
      autosize: true,
      height: 330,
      margin: { l: 78, r: 22, t: 32, b: 56 },
      font: { family: 'IBM Plex Sans, sans-serif', size: 11 },
      hovermode: 'x unified',
      xaxis: {
        type: 'log',
        title: { text: 'Offset frequency (Hz)' },
      },
      yaxis: axis('SSB phase noise L(f) (dBc/Hz)'),
      legend: { orientation: 'h', x: 0, y: 1.14 },
    },
  }
}

function createAntennaFigure(result: SimulationOutput): {
  data: Data[]
  layout: Partial<Layout>
} {
  return {
    data: [
      {
        type: 'scatter',
        mode: 'lines',
        name: 'Normalized power cut',
        x: Array.from(result.antenna.angleDeg),
        y: Array.from(result.antenna.normalizedPatternDb),
        line: {
          color: TRACE_STYLES[2].color,
          width: SCIENTIFIC_PLOT_LINE_WIDTHS.emphasis,
        },
        hovertemplate: '%{x:.0f}°: %{y:.2f} dB<extra></extra>',
      },
    ],
    layout: {
      autosize: true,
      height: 330,
      margin: { l: 68, r: 22, t: 32, b: 56 },
      font: { family: 'IBM Plex Sans, sans-serif', size: 11 },
      showlegend: false,
      xaxis: {
        title: { text: 'Angle from boresight (°)' },
        range: [-180, 180],
        dtick: 45,
      },
      yaxis: { ...axis('Normalized power (dB)'), range: [-60, 0] },
    },
  }
}

function createNonlinearFigure(result: SimulationOutput): {
  data: Data[]
  layout: Partial<Layout>
} {
  const nonlinear = result.nonlinear
  const inputPowerDbm = Array.from(nonlinear.inputPowerDbm)
  const data: Data[] = [
    {
      type: 'scatter',
      mode: 'lines',
      name: 'Linear fundamental',
      x: inputPowerDbm,
      y: Array.from(nonlinear.linearOutputPowerDbm),
      line: {
        color: '#6b7280',
        dash: 'dash',
        width: SCIENTIFIC_PLOT_LINE_WIDTHS.primary,
      },
      hovertemplate: 'Linear output: %{y:.3f} dBm<extra></extra>',
    },
  ]
  if (nonlinear.inputP1Dbm !== null) {
    data.push({
      type: 'scatter',
      mode: 'lines',
      name: 'Compressed fundamental',
      x: inputPowerDbm,
      y: Array.from(nonlinear.compressedOutputPowerDbm),
      line: {
        color: TRACE_STYLES[1].color,
        width: SCIENTIFIC_PLOT_LINE_WIDTHS.emphasis,
      },
      hovertemplate: 'Compressed output: %{y:.3f} dBm<extra></extra>',
    })
  }
  if (nonlinear.outputIp3Dbm !== null) {
    data.push({
      type: 'scatter',
      mode: 'lines',
      name: 'IM<sub>3</sub> extrapolation',
      x: inputPowerDbm,
      y: Array.from(nonlinear.im3OutputPowerDbm),
      line: {
        color: TRACE_STYLES[3].color,
        dash: 'dot',
        width: SCIENTIFIC_PLOT_LINE_WIDTHS.primary,
      },
      hovertemplate: 'IM<sub>3</sub> output: %{y:.3f} dBm<extra></extra>',
    })
  }
  if (
    Array.from(nonlinear.outputPhaseDeg).some(
      (value) => Math.abs(value) > 1e-12,
    )
  ) {
    data.push({
      type: 'scatter',
      mode: 'lines',
      name: 'AM/PM phase',
      x: inputPowerDbm,
      y: Array.from(nonlinear.outputPhaseDeg),
      yaxis: 'y2',
      line: {
        color: TRACE_STYLES[2].color,
        dash: 'dashdot',
        width: SCIENTIFIC_PLOT_LINE_WIDTHS.primary,
      },
      hovertemplate: 'Output phase: %{y:.3f}°<extra></extra>',
    })
  }
  if (
    nonlinear.operatingInputPowerDbm !== null &&
    nonlinear.operatingOutputPowerDbm !== null
  ) {
    data.push({
      type: 'scatter',
      mode: 'markers',
      name: 'Configured source',
      x: [nonlinear.operatingInputPowerDbm],
      y: [nonlinear.operatingOutputPowerDbm],
      marker: { color: TRACE_STYLES[0].color, size: 9, symbol: 'diamond' },
      hovertemplate:
        'Configured source: %{x:.3f} dBm<br>Output: %{y:.3f} dBm<extra></extra>',
    })
  }

  return {
    data,
    layout: {
      autosize: true,
      height: 330,
      margin: { l: 68, r: 68, t: 32, b: 56 },
      font: {
        family: 'IBM Plex Sans, sans-serif',
        size: 11,
      },
      hovermode: 'x unified',
      uirevision: 'nonlinear-power',
      xaxis: {
        title: { text: 'Per-tone input power (dBm)' },
        zeroline: false,
      },
      yaxis: axis('Output power (dBm)'),
      yaxis2: {
        title: { text: 'AM/PM phase (°)' },
        overlaying: 'y',
        side: 'right',
        showgrid: false,
      },
      legend: { orientation: 'h', x: 0, y: 1.14 },
    },
  }
}

function axis(title: string): Partial<Layout['yaxis']> {
  return {
    title: { text: title },
  }
}

function probeTraceStyle(index: number) {
  return {
    color: PROBE_COLORS[index % PROBE_COLORS.length],
    dash: PROBE_DASHES[
      (index + Math.floor(index / PROBE_COLORS.length)) % PROBE_DASHES.length
    ],
  }
}

function createSmithFigure(result: SimulationOutput): {
  data: Data[]
  layout: Partial<Layout>
} {
  const circle = Array.from(
    { length: 181 },
    (_, index) => (2 * Math.PI * index) / 180,
  )
  return {
    data: [
      {
        type: 'scatter',
        mode: 'lines',
        name: '|Γ| = 1',
        x: circle.map(Math.cos),
        y: circle.map(Math.sin),
        hoverinfo: 'skip',
        line: {
          color: '#94a3b8',
          dash: 'dot',
          width: SCIENTIFIC_PLOT_LINE_WIDTHS.reference,
        },
      },
      {
        type: 'scatter',
        mode: 'lines',
        name: 'S<sub>11</sub>',
        x: Array.from(result.total.s11.re),
        y: Array.from(result.total.s11.im),
        customdata: Array.from(result.total.frequencyHz),
        line: {
          color: TRACE_STYLES[0].color,
          width: SCIENTIFIC_PLOT_LINE_WIDTHS.primary,
        },
        hovertemplate:
          'S<sub>11</sub> = %{x:.4f} %{y:+.4f}j<br>f = %{customdata:.6g} Hz<extra></extra>',
      },
    ],
    layout: {
      autosize: true,
      height: 330,
      margin: { l: 58, r: 22, t: 32, b: 48 },
      font: {
        family: 'IBM Plex Sans, sans-serif',
        size: 11,
      },
      hovermode: 'closest',
      xaxis: {
        title: { text: 'Re(Γ)' },
        range: [-1.05, 1.05],
        scaleanchor: 'y',
        scaleratio: 1,
      },
      yaxis: {
        title: { text: 'Im(Γ)' },
        range: [-1.05, 1.05],
      },
      legend: { orientation: 'h', x: 0, y: 1.12 },
      uirevision: 'smith',
    },
  }
}

function resolveFrequencyUnit(
  requested: FrequencyUnit,
  maximumFrequencyHz: number,
): Exclude<FrequencyUnit, 'auto'> {
  if (requested !== 'auto') return requested
  if (maximumFrequencyHz >= 1e9) return 'GHz'
  if (maximumFrequencyHz >= 1e6) return 'MHz'
  if (maximumFrequencyHz >= 1e3) return 'kHz'
  return 'Hz'
}

function frequencyScale(unit: Exclude<FrequencyUnit, 'auto'>): number {
  return { Hz: 1, kHz: 1e3, MHz: 1e6, GHz: 1e9 }[unit]
}

function plotTitle(view: PlotView, frequencyConverting = false): string {
  return {
    sParameters: frequencyConverting
      ? 'Conversion-path magnitude'
      : 'S-parameter magnitude',
    smith: 'S11 Smith chart',
    stability: 'Stability and passivity checks',
    phase: 'Unwrapped S21 phase',
    groupDelay: 'S21 group delay',
    probes: 'Cumulative S21 at probe planes',
    nonlinear: 'Nonlinear transfer and IM3',
    oscillator: 'Oscillator phase noise',
    antenna: 'Antenna radiation cut',
  }[view]
}
