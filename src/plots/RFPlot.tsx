import { useEffect, useMemo, useRef } from 'react'
import type { Config, Data, Layout } from 'plotly.js'
import type { SimulationOutput } from '../engine/types'

export type PlotView =
  | 'sParameters'
  | 'smith'
  | 'stability'
  | 'phase'
  | 'groupDelay'
  | 'probes'
  | 'nonlinear'
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
  '#000000',
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

  return (
    <PlotlyFigure
      ariaLabel={
        view === 'nonlinear'
          ? 'Nonlinear transfer and IM3 versus per-tone input power'
          : `${plotTitle(view, frequencyConverting)} versus frequency`
      }
      config={{
        displaylogo: false,
        responsive: true,
        scrollZoom: true,
        toImageButtonOptions: {
          format: 'svg',
          filename: `rf-${view}`,
          width: 1200,
          height: 650,
          scale: 1,
        },
      }}
      data={figure.data}
      layout={figure.layout}
    />
  )
}

function PlotlyFigure({
  data,
  layout,
  config,
  ariaLabel,
}: {
  data: Data[]
  layout: Partial<Layout>
  config: Partial<Config>
  ariaLabel: string
}) {
  const plotRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = plotRef.current
    if (!element) return
    let cancelled = false
    let plotly: typeof import('plotly.js-basic-dist-min').default | undefined

    void import('plotly.js-basic-dist-min').then((module) => {
      if (cancelled) return
      plotly = module.default
      return plotly.react(element, data, layout, config)
    })

    return () => {
      cancelled = true
      if (plotly) plotly.purge(element)
    }
  }, [config, data, layout])

  return (
    <div className="rf-plot" ref={plotRef} role="img" aria-label={ariaLabel} />
  )
}

function createFigure(
  result: SimulationOutput,
  view: PlotView,
  unit: Exclude<FrequencyUnit, 'auto'>,
  frequency: number[],
): { data: Data[]; layout: Partial<Layout> } {
  if (view === 'nonlinear') return createNonlinearFigure(result)
  if (view === 'smith') return createSmithFigure(result)

  const commonLayout: Partial<Layout> = {
    autosize: true,
    height: 330,
    margin: { l: 68, r: 22, t: 32, b: 56 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: '#ffffff',
    font: {
      family: 'Inter, Arial, sans-serif',
      size: 12,
      color: '#334155',
    },
    hovermode: 'x unified',
    uirevision: `${view}-${unit}`,
    xaxis: {
      title: { text: `Frequency (${unit})` },
      gridcolor: '#e8edf0',
      zeroline: false,
      showline: true,
      linecolor: '#aab5be',
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
      ['μ source', result.networkChecks.stabilityMuSource],
      ['μ load', result.networkChecks.stabilityMuLoad],
      ['σmax(S)', result.networkChecks.passivityMaximumSingularValue],
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
          width: 2,
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
            line: { color: '#64748b', dash: 'dot', width: 1 },
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
            line: { color: TRACE_STYLES[1].color, width: 2 },
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
      ['S11', result.curves.s11Db],
      ['S21', result.curves.s21Db],
      ['S12', result.curves.s12Db],
      ['S22', result.curves.s22Db],
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
          width: 2,
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
        line: { ...probeTraceStyle(index), width: 2 },
        hovertemplate: `${conversion ? 'Accumulated conversion gain' : 'Accumulated S21'}: %{y:.3f} dB<extra>%{fullData.name}</extra>`,
      })),
      layout: {
        ...commonLayout,
        yaxis: axis(
          conversion
            ? 'Cumulative conversion magnitude (dB)'
            : 'Cumulative S21 magnitude (dB)',
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
          name: '∠S21',
          x: frequency,
          y: Array.from(result.curves.s21PhaseDeg),
          connectgaps: false,
          line: { color: TRACE_STYLES[0].color, width: 2 },
          hovertemplate: 'Phase: %{y:.3f}°<extra></extra>',
        },
      ],
      layout: {
        ...commonLayout,
        showlegend: false,
        yaxis: axis('Unwrapped phase of S21 (deg)'),
      },
    }
  }

  return {
    data: [
      {
        type: 'scatter',
        mode: 'lines',
        name: 'τg(S21)',
        x: frequency,
        y: [...result.curves.s21GroupDelayS].map((value) => value * 1e9),
        connectgaps: false,
        line: { color: TRACE_STYLES[2].color, width: 2 },
        hovertemplate: 'Group delay: %{y:.4f} ns<extra></extra>',
      },
    ],
    layout: {
      ...commonLayout,
      showlegend: false,
      yaxis: axis('Group delay of S21 (ns)'),
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
      line: { color: '#6b7280', dash: 'dash', width: 2 },
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
      line: { color: TRACE_STYLES[1].color, width: 2.5 },
      hovertemplate: 'Compressed output: %{y:.3f} dBm<extra></extra>',
    })
  }
  if (nonlinear.outputIp3Dbm !== null) {
    data.push({
      type: 'scatter',
      mode: 'lines',
      name: 'IM3 extrapolation',
      x: inputPowerDbm,
      y: Array.from(nonlinear.im3OutputPowerDbm),
      line: { color: TRACE_STYLES[3].color, dash: 'dot', width: 2 },
      hovertemplate: 'IM3 output: %{y:.3f} dBm<extra></extra>',
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
      line: { color: TRACE_STYLES[2].color, dash: 'dashdot', width: 2 },
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
      marker: { color: '#000000', size: 9, symbol: 'diamond' },
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
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: '#ffffff',
      font: {
        family: 'Inter, Arial, sans-serif',
        size: 12,
        color: '#334155',
      },
      hovermode: 'x unified',
      uirevision: 'nonlinear-power',
      xaxis: {
        title: { text: 'Per-tone input power (dBm)' },
        gridcolor: '#e8edf0',
        zeroline: false,
        showline: true,
        linecolor: '#aab5be',
      },
      yaxis: axis('Output power (dBm)'),
      yaxis2: {
        title: { text: 'AM/PM phase (deg)' },
        overlaying: 'y',
        side: 'right',
        showgrid: false,
        zerolinecolor: '#cbd5dc',
      },
      legend: { orientation: 'h', x: 0, y: 1.14 },
    },
  }
}

function axis(title: string): Partial<Layout['yaxis']> {
  return {
    title: { text: title },
    gridcolor: '#e8edf0',
    zerolinecolor: '#cbd5dc',
    showline: true,
    linecolor: '#aab5be',
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
        line: { color: '#94a3b8', dash: 'dot', width: 1 },
      },
      {
        type: 'scatter',
        mode: 'lines',
        name: 'S11',
        x: Array.from(result.total.s11.re),
        y: Array.from(result.total.s11.im),
        customdata: Array.from(result.total.frequencyHz),
        line: { color: TRACE_STYLES[0].color, width: 2 },
        hovertemplate:
          'S11 = %{x:.4f} %{y:+.4f}j<br>f = %{customdata:.6g} Hz<extra></extra>',
      },
    ],
    layout: {
      autosize: true,
      height: 330,
      margin: { l: 58, r: 22, t: 32, b: 48 },
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: '#ffffff',
      font: {
        family: 'Inter, Arial, sans-serif',
        size: 12,
        color: '#334155',
      },
      hovermode: 'closest',
      xaxis: {
        title: { text: 'Re(Γ)' },
        range: [-1.05, 1.05],
        scaleanchor: 'y',
        scaleratio: 1,
        gridcolor: '#e8edf0',
        zerolinecolor: '#cbd5e1',
      },
      yaxis: {
        title: { text: 'Im(Γ)' },
        range: [-1.05, 1.05],
        gridcolor: '#e8edf0',
        zerolinecolor: '#cbd5e1',
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
  }[view]
}
