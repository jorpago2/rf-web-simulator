import { describe, expect, it } from 'vitest'
import { parseMixerProductCsv } from './mixerProducts'

describe('measured mixer product tables', () => {
  it('parses signed mixing coefficients, level, and phase', () => {
    const products = parseMixerProductCsv(
      'm,n,relative_level_db,phase_deg,label\n1,-1,-7,12,IF\n2,-1,-38,-20,IM3',
    )
    expect(products).toEqual([
      {
        inputCoefficient: 1,
        loCoefficient: -1,
        relativeLevelDb: -7,
        phaseDeg: 12,
        label: 'IF',
      },
      {
        inputCoefficient: 2,
        loCoefficient: -1,
        relativeLevelDb: -38,
        phaseDeg: -20,
        label: 'IM3',
      },
    ])
  })
})
