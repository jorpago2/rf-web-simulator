import { describe, expect, it } from 'vitest'
import { createNPortS, renormalizeNPortNetwork } from './nport'

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
})
