import type { SimulationOutput } from '../engine/types'

const CSV_HEADER = [
  'frequency_hz',
  's11_db',
  's21_db',
  's12_db',
  's22_db',
  's21_phase_deg',
  's21_group_delay_s',
]

export function simulationOutputToCsv(output: SimulationOutput): string {
  const lines = [CSV_HEADER.join(',')]
  for (let index = 0; index < output.total.frequencyHz.length; index += 1) {
    lines.push(
      [
        output.total.frequencyHz[index],
        output.curves.s11Db[index],
        output.curves.s21Db[index],
        output.curves.s12Db[index],
        output.curves.s22Db[index],
        output.curves.s21PhaseDeg[index],
        output.curves.s21GroupDelayS[index],
      ]
        .map(csvNumber)
        .join(','),
    )
  }
  return `${lines.join('\n')}\n`
}

function csvNumber(value: number | undefined): string {
  return value !== undefined && Number.isFinite(value) ? String(value) : ''
}
