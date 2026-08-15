import { describe, expect, it } from 'vitest'
import { createNPortS } from './nport'
import { enforceNPortPassivity, maximumSingularValue } from './passivity'

describe('passivity enforcement', () => {
  it('conservatively scales a non-passive matrix to sigmaMax = 1', () => {
    const network = {
      frequencyHz: new Float64Array([1e9]),
      portCount: 2,
      referenceImpedancesOhm: new Float64Array([50, 50]),
      s: createNPortS(2, 1),
    }
    network.s[2]!.re[0] = 2
    const result = enforceNPortPassivity(network)
    const matrix = result.network.s.map((value) => ({
      re: value.re[0]!,
      im: value.im[0]!,
    }))
    expect(result.correctedPointCount).toBe(1)
    expect(result.maximumOriginalSingularValue).toBeCloseTo(2, 10)
    expect(maximumSingularValue(matrix, 2)).toBeCloseTo(1, 10)
    expect(
      maximumSingularValue(
        [
          { re: 0, im: 0 },
          { re: 3, im: 0 },
          { re: 0, im: 0 },
          { re: 0, im: 0 },
        ],
        2,
      ),
    ).toBeCloseTo(3, 10)
  })

  it('detects a dominant singular vector orthogonal to the former fixed start', () => {
    const matrix = [
      { re: 1.05, im: 0 },
      { re: -0.007797, im: 0.049388 },
      { re: -0.007797, im: -0.049388 },
      { re: 1.05, im: 0 },
    ]
    expect(maximumSingularValue(matrix, 2)).toBeCloseTo(1.1, 5)
  })

  it('is invariant under a complex unitary rotation', () => {
    const inverseSqrtTwo = 1 / Math.sqrt(2)
    const matrix = [
      { re: 2 * inverseSqrtTwo, im: 0 },
      { re: 0, im: 2 * inverseSqrtTwo },
      { re: inverseSqrtTwo, im: 0 },
      { re: 0, im: -inverseSqrtTwo },
    ]
    expect(maximumSingularValue(matrix, 2)).toBeCloseTo(2, 12)
  })
})
