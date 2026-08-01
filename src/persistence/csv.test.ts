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
    networkChecks: {
      stabilityK: new Float64Array([1.5]),
      stabilityMuSource: new Float64Array([1.2]),
      stabilityMuLoad: new Float64Array([1.3]),
      passivityMaximumSingularValue: new Float64Array([1.01]),
      reciprocityErrorMagnitude: new Float64Array([0.02]),
      causalityPreEchoEnergyDb: -42,
      causalityTimeResolutionS: 1e-9,
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
      sourceImpedanceOhm: 50,
      loadImpedanceOhm: 50,
      transducerGainDb: 10.25,
      deliveredLoadPowerDbm: 10.25,
      cascadedNoiseFigureDb: 2,
      stages: [],
      warnings: [],
    },
    nonlinear: {
      available: true,
      inputPowerDbm: new Float64Array([-10]),
      linearOutputPowerDbm: new Float64Array([0]),
      compressedOutputPowerDbm: new Float64Array([-1]),
      outputPhaseDeg: new Float64Array([-4]),
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
      envelopeSpectrum: [],
      spectrumInputPowerDbm: -10,
    },
    frequencyPlan: {
      input: { startHz: 1.25e9, centerHz: 1.25e9, stopHz: 1.25e9 },
      output: { startHz: 0.25e9, centerHz: 0.25e9, stopHz: 0.25e9 },
      outputFrequencyHz: new Float64Array([0.25e9]),
      stages: [],
      spectralLines: [],
    },
    monteCarlo: {
      available: false,
      runs: 0,
      seed: 1,
      metrics: [],
      sensitivities: [],
      yieldPercent: null,
      passingRuns: null,
    },
    parametricSweep: {
      available: false,
      nodeId: null,
      nodeLabel: null,
      parameter: null,
      metric: 's21Db',
      objective: 'maximize',
      parameterValues: new Float64Array(),
      metricValues: new Float64Array(),
      bestParameterValue: null,
      bestMetricValue: null,
      variables: [],
      samples: [],
      bestParameterValues: [],
      constraint: null,
    },
    warnings: [],
  }

  expect(simulationOutputToCsv(output)).toBe(
    'frequency_hz,output_frequency_hz,s11_db,s21_db,s12_db,s22_db,s21_phase_deg,s21_group_delay_s,stability_k,stability_mu_source,stability_mu_load,passivity_maximum_singular_value,reciprocity_error_magnitude,causality_pre_echo_energy_db,causality_time_resolution_s,"probe_s21_db:Input, plane [probe""1]"\n' +
      '1250000000,250000000,-20.5,10.25,-40,-18,,2.5e-9,1.5,1.2,1.3,1.01,0.02,-42,1e-9,8.75\n',
  )
  expect(nonlinearSweepToCsv(output)).toBe(
    'input_power_dbm,linear_output_power_dbm,compressed_output_power_dbm,output_phase_deg,im3_output_power_dbm\n' +
      '-10,0,-1,-4,-40\n',
  )
})
