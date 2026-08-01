import { describe, expect, it } from 'vitest'
import { noiseFigureFromParameters } from './noiseParameters'

describe('Touchstone noise parameters', () => {
  it('equals Fmin at GammaOpt and increases for a mismatched source', () => {
    const noise = {
      frequencyHz: new Float64Array([1e9]),
      minimumNoiseFigureDb: new Float64Array([1]),
      optimumSourceReflection: {
        re: new Float64Array([1 / 3]),
        im: new Float64Array([0]),
      },
      effectiveNoiseResistanceOhm: new Float64Array([10]),
    }
    expect(noiseFigureFromParameters(noise, 1e9, 100, 50)).toBeCloseTo(1, 12)
    expect(noiseFigureFromParameters(noise, 1e9, 50, 50)).toBeGreaterThan(1)
  })
})
