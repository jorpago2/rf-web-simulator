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
  'stability_k',
  'stability_mu_source',
  'stability_mu_load',
  'passivity_maximum_singular_value',
  'reciprocity_error_magnitude',
  'causality_pre_echo_energy_db',
  'causality_time_resolution_s',
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
        output.networkChecks.stabilityK[index],
        output.networkChecks.stabilityMuSource[index],
        output.networkChecks.stabilityMuLoad[index],
        output.networkChecks.passivityMaximumSingularValue[index],
        output.networkChecks.reciprocityErrorMagnitude[index],
        output.networkChecks.causalityPreEchoEnergyDb,
        output.networkChecks.causalityTimeResolutionS,
        ...output.probeResults.map((probe) => probe.s21Db[index]),
      ]
        .map(csvNumber)
        .join(','),
    )
  }
  return `${lines.join('\n')}\n`
}

export function nonlinearSweepToCsv(output: SimulationOutput): string {
  const nonlinear = output.nonlinear
  const lines = [
    'input_power_dbm,linear_output_power_dbm,compressed_output_power_dbm,output_phase_deg,im3_output_power_dbm',
  ]
  for (let index = 0; index < nonlinear.inputPowerDbm.length; index += 1) {
    lines.push(
      [
        nonlinear.inputPowerDbm[index],
        nonlinear.linearOutputPowerDbm[index],
        nonlinear.compressedOutputPowerDbm[index],
        nonlinear.outputPhaseDeg[index],
        nonlinear.im3OutputPowerDbm[index],
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

function csvNumber(value: number | null | undefined): string {
  return value !== null && value !== undefined && Number.isFinite(value)
    ? String(value)
    : ''
}
