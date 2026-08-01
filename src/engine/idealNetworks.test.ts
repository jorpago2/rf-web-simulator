import { describe, expect, it } from 'vitest'
import { magnitudeDb, phaseDegrees } from './complex'
import {
  createIdealFilter,
  createIdealIsolator,
  createIdealPhaseShifter,
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
})
