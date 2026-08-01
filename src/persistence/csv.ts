import type { SimulationOutput } from '../engine/types'

const CSV_HEADER = [
  'frequency_hz',
  'output_frequency_hz',
  's11_db',
  's21_db',
  's12_db',
  's22_db',
  's21_phase_deg',
  's21_group_delay_s',
]

export function simulationOutputToCsv(output: SimulationOutput): string {
  const probeHeaders = output.probeResults.map(
    (probe) => `probe_s21_db:${probe.label} [${probe.nodeId}]`,
  )
  const lines = [[...CSV_HEADER, ...probeHeaders].map(csvCell).join(',')]
  for (let index = 0; index < output.total.frequencyHz.length; index += 1) {
    lines.push(
      [
        output.total.frequencyHz[index],
        output.frequencyPlan.outputFrequencyHz[index],
        output.curves.s11Db[index],
        output.curves.s21Db[index],
        output.curves.s12Db[index],
        output.curves.s22Db[index],
        output.curves.s21PhaseDeg[index],
        output.curves.s21GroupDelayS[index],
        ...output.probeResults.map((probe) => probe.s21Db[index]),
      ]
        .map(csvNumber)
        .join(','),
    )
  }
  return `${lines.join('\n')}\n`
}

function csvCell(value: string): string {
  return /[",\n\r]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

function csvNumber(value: number | undefined): string {
  return value !== undefined && Number.isFinite(value) ? String(value) : ''
}
