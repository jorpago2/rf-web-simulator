import { describe, expect, it } from 'vitest'
import { buildCommonFrequencyGrid, interpolateNetwork } from './interpolation'
import type { ComplexArray, TwoPortNetwork } from './types'

function values(re: number[], im: number[]): ComplexArray {
  return { re: new Float64Array(re), im: new Float64Array(im) }
}

function network(startHz: number, stopHz: number): TwoPortNetwork {
  return {
    frequencyHz: new Float64Array([startHz, stopHz]),
    referenceImpedanceOhm: 50,
    s11: values([0, 2], [0, 4]),
    s21: values([1, 3], [-1, 1]),
    s12: values([0, 0], [0, 0]),
    s22: values([0, 0], [0, 0]),
  }
}

describe('Cartesian network interpolation', () => {
  it('interpolates real and imaginary parts independently', () => {
    const result = interpolateNetwork(
      network(1, 3),
      new Float64Array([1, 2, 3]),
    )
    expect(result.s11.re).toEqual(new Float64Array([0, 1, 2]))
    expect(result.s11.im).toEqual(new Float64Array([0, 2, 4]))
    expect(result.s21.re).toEqual(new Float64Array([1, 2, 3]))
    expect(result.s21.im).toEqual(new Float64Array([-1, 0, 1]))
  })

  it('uses the common intersection and warns when clipping', () => {
    const result = buildCommonFrequencyGrid([network(2, 5), network(3, 6)], {
      startHz: 1,
      stopHz: 7,
      points: 3,
      referenceImpedanceOhm: 50,
    })

    expect(result.frequencyHz).toEqual(new Float64Array([3, 4, 5]))
    expect(result.warnings[0]?.code).toBe('RANGE_CLIPPED')
  })

  it('does not extrapolate outside the source range', () => {
    expect(() =>
      interpolateNetwork(network(1, 3), new Float64Array([0, 1, 2])),
    ).toThrow(/exceeds/u)
  })
})
