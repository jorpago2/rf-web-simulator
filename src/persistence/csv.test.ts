import { expect, it } from 'vitest'
import type { SimulationOutput } from '../engine/types'
import { nonlinearSweepToCsv, simulationOutputToCsv } from './csv'

it('exports interoperable scientific CSV with empty undefined values', () => {
  const empty = { re: new Float64Array([0]), im: new Float64Array([0]) }
  const output: SimulationOutput = {
    total: {
      frequencyHz: new Float64Array([1.25e9]),
      referenceImpedanceOhm: 50,
      s11: empty,
      s21: empty,
      s12: empty,
      s22: empty,
    },
    curves: {
      s11Db: new Float64Array([-20.5]),
      s21Db: new Float64Array([10.25]),
      s12Db: new Float64Array([-40]),
      s22Db: new Float64Array([-18]),
      s21PhaseDeg: new Float64Array([Number.NaN]),
      s21GroupDelayS: new Float64Array([2.5e-9]),
    },
    stageSummaries: [],
    probeResults: [
      {
        nodeId: 'probe"1',
        label: 'Input, plane',
        s21Db: new Float64Array([8.75]),
      },
    ],
    budget: {
      centerFrequencyHz: 1.25e9,
      sourcePowerDbm: 0,
      stages: [],
      warnings: [],
    },
    nonlinear: {
      available: true,
      inputPowerDbm: new Float64Array([-10]),
      linearOutputPowerDbm: new Float64Array([0]),
      compressedOutputPowerDbm: new Float64Array([-1]),
      im3OutputPowerDbm: new Float64Array([-40]),
      smallSignalGainDb: 10,
      inputP1Dbm: -10,
      outputP1Dbm: -1,
      outputIp3Dbm: 20,
      operatingInputPowerDbm: -10,
      operatingOutputPowerDbm: -1,
      toneSpacingHz: 10e6,
      toneFrequenciesHz: [1.245e9, 1.255e9],
      im3FrequenciesHz: [1.235e9, 1.265e9],
      limitingStageLabel: 'Amplifier',
    },
    frequencyPlan: {
      input: { startHz: 1.25e9, centerHz: 1.25e9, stopHz: 1.25e9 },
      output: { startHz: 0.25e9, centerHz: 0.25e9, stopHz: 0.25e9 },
      outputFrequencyHz: new Float64Array([0.25e9]),
      stages: [],
    },
    warnings: [],
  }

  expect(simulationOutputToCsv(output)).toBe(
    'frequency_hz,output_frequency_hz,s11_db,s21_db,s12_db,s22_db,s21_phase_deg,s21_group_delay_s,"probe_s21_db:Input, plane [probe""1]"\n' +
      '1250000000,250000000,-20.5,10.25,-40,-18,,2.5e-9,8.75\n',
  )
  expect(nonlinearSweepToCsv(output)).toBe(
    'input_power_dbm,linear_output_power_dbm,compressed_output_power_dbm,im3_output_power_dbm\n' +
      '-10,0,-1,-40\n',
  )
})
