import { useEffect, useMemo, useRef } from 'react'
import type { Config, Data, Layout } from 'plotly.js'
import type { SimulationOutput } from '../engine/types'

export type PlotView = 'sParameters' | 'phase' | 'groupDelay' | 'probes'
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
  const frequencyConverting = result.frequencyPlan.stages.length > 0

  return (
    <PlotlyFigure
      ariaLabel={`${plotTitle(view, frequencyConverting)} versus frequency`}
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

  if (view === 'sParameters') {
    if (result.frequencyPlan.stages.length > 0) {
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
    const conversion = result.frequencyPlan.stages.length > 0
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
    phase: 'Unwrapped S21 phase',
    groupDelay: 'S21 group delay',
    probes: 'Cumulative S21 at probe planes',
  }[view]
}
