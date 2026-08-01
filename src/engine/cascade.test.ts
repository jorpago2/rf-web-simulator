import { describe, expect, it } from 'vitest'
import { cascadeTwoPorts } from './cascade'
import { fromPolar, magnitudeDb, phaseDegrees } from './complex'
import { createIdealAttenuator, createThroughNetwork } from './idealNetworks'
import type { ComplexArray, TwoPortNetwork } from './types'

const frequencyHz = new Float64Array([1e9, 2e9])

describe('two-port cascade', () => {
  it('keeps two ideal through networks equal to a through', () => {
    const result = cascadeTwoPorts(
      createThroughNetwork(frequencyHz, 50),
      createThroughNetwork(frequencyHz, 50),
    ).network

    expect(result.s11.re).toEqual(new Float64Array([0, 0]))
    expect(result.s21.re).toEqual(new Float64Array([1, 1]))
    expect(result.s12.re).toEqual(new Float64Array([1, 1]))
  })

  it('adds matched attenuation and phase in the forward path', () => {
    const first = createIdealAttenuator(frequencyHz, 3, 20, 50)
    const second = createIdealAttenuator(frequencyHz, 6, 25, 50)
    const result = cascadeTwoPorts(first, second).network
    const s21 = { re: result.s21.re[0]!, im: result.s21.im[0]! }

    expect(magnitudeDb(s21)).toBeCloseTo(-9, 10)
    expect(phaseDegrees(s21)).toBeCloseTo(45, 10)
  })

  it('includes internal reflections instead of summing S21 in dB', () => {
    const first = constantNetwork({ s11: 0, s21: 0.8, s12: 0.8, s22: 0.5 })
    const second = constantNetwork({ s11: 0.5, s21: 0.8, s12: 0.8, s22: 0 })
    const result = cascadeTwoPorts(first, second).network

    expect(result.s21.re[0]).toBeCloseTo((0.8 * 0.8) / (1 - 0.5 * 0.5))
    expect(result.s21.re[0]).not.toBeCloseTo(0.8 * 0.8)
  })

  it('recovers a matched through from opposite reciprocal phases', () => {
    const forward = fromPolar(1, 37)
    const inverse = fromPolar(1, -37)
    const result = cascadeTwoPorts(
      constantNetwork({ s11: 0, s21: forward, s12: forward, s22: 0 }),
      constantNetwork({ s11: 0, s21: inverse, s12: inverse, s22: 0 }),
    ).network

    expect(result.s21.re[0]).toBeCloseTo(1, 12)
    expect(result.s21.im[0]).toBeCloseTo(0, 12)
    expect(result.s12.re[0]).toBeCloseTo(1, 12)
  })

  it('reports and regularizes a near-singular internal reflection', () => {
    const result = cascadeTwoPorts(
      constantNetwork({ s11: 0, s21: 1, s12: 1, s22: 1 }),
      constantNetwork({ s11: 1, s21: 1, s12: 1, s22: 0 }),
    )

    expect(result.warnings[0]?.code).toBe('CASCADE_NEAR_SINGULAR')
    expect(Number.isFinite(result.network.s21.re[0])).toBe(true)
  })

  it('rejects reference-impedance mismatch', () => {
    expect(() =>
      cascadeTwoPorts(
        createThroughNetwork(frequencyHz, 50),
        createThroughNetwork(frequencyHz, 75),
      ),
    ).toThrow(/mismatch/u)
  })
})

type ScalarOrComplex = number | { re: number; im: number }

function constantNetwork(parameters: {
  s11: ScalarOrComplex
  s21: ScalarOrComplex
  s12: ScalarOrComplex
  s22: ScalarOrComplex
}): TwoPortNetwork {
  return {
    frequencyHz,
    referenceImpedanceOhm: 50,
    s11: constantArray(parameters.s11),
    s21: constantArray(parameters.s21),
    s12: constantArray(parameters.s12),
    s22: constantArray(parameters.s22),
  }
}

function constantArray(value: ScalarOrComplex): ComplexArray {
  const complex = typeof value === 'number' ? { re: value, im: 0 } : value
  return {
    re: new Float64Array([complex.re, complex.re]),
    im: new Float64Array([complex.im, complex.im]),
  }
}
