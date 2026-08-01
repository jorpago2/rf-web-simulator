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
})
