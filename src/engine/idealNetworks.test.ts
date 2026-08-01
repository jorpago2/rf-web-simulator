import { describe, expect, it } from 'vitest'
import { magnitudeDb, phaseDegrees } from './complex'
import {
  createIdealDiplexer,
  createIdealDirectionalCoupler,
  createIdealFilter,
  createIdealIsolator,
  createIdealPhaseShifter,
  createIdealRFSwitch,
} from './idealNetworks'
import { calculateNetworkChecks } from './networkChecks'

describe('additional ideal RF networks', () => {
  it('matches the Butterworth cutoff and remains reciprocal and passive', () => {
    const network = createIdealFilter(
      new Float64Array([0, 1e9, 2e9]),
      'lowpass',
      1e9,
      1,
      3,
      1,
      50,
    )
    expect(
      magnitudeDb({ re: network.s21.re[0]!, im: network.s21.im[0]! }),
    ).toBeCloseTo(-1, 10)
    expect(
      magnitudeDb({ re: network.s21.re[1]!, im: network.s21.im[1]! }),
    ).toBeCloseTo(-4.0103, 3)
    expect(network.s12).toEqual(network.s21)
    expect(
      calculateNetworkChecks(network).passivityMaximumSingularValue[0],
    ).toBeLessThanOrEqual(1)
  })

  it('applies matched phase shift and insertion loss', () => {
    const network = createIdealPhaseShifter(new Float64Array([1e9]), 90, 2, 50)
    const s21 = { re: network.s21.re[0]!, im: network.s21.im[0]! }
    expect(magnitudeDb(s21)).toBeCloseTo(-2, 10)
    expect(phaseDegrees(s21)).toBeCloseTo(90, 10)
  })

  it('provides passive non-reciprocal isolation', () => {
    const network = createIdealIsolator(new Float64Array([1e9]), 1, 30, 0, 50)
    expect(
      magnitudeDb({ re: network.s21.re[0]!, im: network.s21.im[0]! }),
    ).toBeCloseTo(-1, 10)
    expect(
      magnitudeDb({ re: network.s12.re[0]!, im: network.s12.im[0]! }),
    ).toBeCloseTo(-30, 10)
    expect(
      calculateNetworkChecks(network).passivityMaximumSingularValue[0],
    ).toBeLessThan(1)
  })

  it('models RF switch insertion loss and OFF isolation', () => {
    const frequencyHz = new Float64Array([1e9])
    const on = createIdealRFSwitch(frequencyHz, true, 1, 40, 0, 50)
    const off = createIdealRFSwitch(frequencyHz, false, 1, 40, 0, 50)
    expect(magnitudeDb({ re: on.s21.re[0]!, im: on.s21.im[0]! })).toBeCloseTo(
      -1,
      10,
    )
    expect(
      magnitudeDb({ re: off.s21.re[0]!, im: off.s21.im[0]! }),
    ).toBeCloseTo(-40, 10)
  })

  it('conserves the configured coupler output power apart from excess loss', () => {
    const network = createIdealDirectionalCoupler(
      new Float64Array([1e9]),
      20,
      0.5,
      50,
    )
    const through = network.s[1 * 3]!
    const coupled = network.s[2 * 3]!
    const outputPower =
      through.re[0]! ** 2 +
      through.im[0]! ** 2 +
      coupled.re[0]! ** 2 +
      coupled.im[0]! ** 2
    expect(outputPower).toBeCloseTo(10 ** (-0.5 / 10), 12)
    expect(
      magnitudeDb({ re: coupled.re[0]!, im: coupled.im[0]! }) -
        magnitudeDb({ re: through.re[0]!, im: through.im[0]! }),
    ).toBeCloseTo(10 * Math.log10(0.01 / 0.99), 10)
  })

  it('splits complementary LP and HP power at the diplexer crossover', () => {
    const network = createIdealDiplexer(
      new Float64Array([1e9]),
      1e9,
      3,
      1,
      50,
    )
    const low = network.s[1 * 3]!
    const high = network.s[2 * 3]!
    expect(magnitudeDb({ re: low.re[0]!, im: low.im[0]! })).toBeCloseTo(
      -4.0103,
      3,
    )
    expect(magnitudeDb({ re: high.re[0]!, im: high.im[0]! })).toBeCloseTo(
      -4.0103,
      3,
    )
    expect(
      low.re[0]! ** 2 +
        low.im[0]! ** 2 +
        high.re[0]! ** 2 +
        high.im[0]! ** 2,
    ).toBeCloseTo(10 ** (-1 / 10), 10)
  })
})
