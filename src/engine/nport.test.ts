import { describe, expect, it } from 'vitest'
import {
  createNPortS,
  nPortToTwoPort,
  renormalizeNPortNetwork,
  solveComplexLinearSystem,
} from './nport'

describe('N-port network operations', () => {
  it('renormalizes a matched through without changing its transmission', () => {
    const s = createNPortS(2, 1)
    s[1]!.re[0] = 1
    s[2]!.re[0] = 1

    const result = renormalizeNPortNetwork(
      {
        frequencyHz: new Float64Array([1e9]),
        portCount: 2,
        referenceImpedancesOhm: new Float64Array([50, 50]),
        s,
      },
      75,
    )

    expect(result.s[0]?.re[0]).toBeCloseTo(0, 12)
    expect(result.s[1]?.re[0]).toBeCloseTo(1, 12)
    expect(result.s[2]?.re[0]).toBeCloseTo(1, 12)
    expect(result.s[3]?.re[0]).toBeCloseTo(0, 12)
  })

  it('maps a matched 50-ohm load to the expected 75-ohm reflection', () => {
    const result = renormalizeNPortNetwork(
      {
        frequencyHz: new Float64Array([1e9]),
        portCount: 1,
        referenceImpedancesOhm: new Float64Array([50]),
        s: createNPortS(1, 1),
      },
      75,
    )

    expect(result.s[0]?.re[0]).toBeCloseTo((50 - 75) / (50 + 75), 12)
    expect(result.s[0]?.im[0]).toBeCloseTo(0, 12)
  })

  it('rejects a non-finite reference impedance on either port', () => {
    expect(() =>
      nPortToTwoPort({
        frequencyHz: new Float64Array([1e9]),
        portCount: 2,
        referenceImpedancesOhm: new Float64Array([50, Number.NaN]),
        s: createNPortS(2, 1),
      }),
    ).toThrow(/equal real reference impedances/)
  })

  it('reports conditioning and backward residual for an accepted solve', () => {
    const matrix = [1, 1, 1, 1 + 1e-13].map((re) => ({ re, im: 0 }))
    const right = [2, 2 + 1e-13].map((re) => ({ re, im: 0 }))
    const result = solveComplexLinearSystem(matrix, right, 1)

    expect(result.solution[0]?.re).toBeCloseTo(1, 3)
    expect(result.solution[1]?.re).toBeCloseTo(1, 3)
    expect(result.diagnostics.reciprocalConditionEstimate).toBeLessThan(1e-12)
    expect(result.diagnostics.normalizedResidual).toBeLessThan(1e-14)
  })

  it.each([1e-20, 1e20])(
    'uses scale-aware pivoting for an equivalent system scaled by %g',
    (scale) => {
      const matrix = [2, 1, 1, 3].map((re) => ({ re: re * scale, im: 0 }))
      const right = [3, 4].map((re) => ({ re: re * scale, im: 0 }))
      const result = solveComplexLinearSystem(matrix, right, 1)

      expect(result.solution[0]?.re).toBeCloseTo(1, 12)
      expect(result.solution[1]?.re).toBeCloseTo(1, 12)
      expect(result.diagnostics.normalizedResidual).toBeLessThan(1e-14)
    },
  )
})
