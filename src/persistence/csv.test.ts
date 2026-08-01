import { expect, it } from 'vitest'
import type { SimulationOutput } from '../engine/types'
import { simulationOutputToCsv } from './csv'

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
    warnings: [],
  }

  expect(simulationOutputToCsv(output)).toBe(
    'frequency_hz,s11_db,s21_db,s12_db,s22_db,s21_phase_deg,s21_group_delay_s,"probe_s21_db:Input, plane [probe""1]"\n' +
      '1250000000,-20.5,10.25,-40,-18,,2.5e-9,8.75\n',
  )
})
