import { describe, expect, it } from 'vitest'
import { createIdealAttenuator, createThroughNetwork } from './idealNetworks'
import { twoPortToNPort } from './nport'
import {
  noiseFigureFromCorrelation,
  passiveNoiseCorrelationAt,
  touchstoneNoiseCorrelationAt,
} from './noiseWaves'

describe('noise-wave models', () => {
  it('recovers the loss noise figure of a passive matched attenuator', () => {
    const network = createIdealAttenuator(
      new Float64Array([1e9]),
      3.01029995664,
      0,
      50,
    )
    const correlation = passiveNoiseCorrelationAt(twoPortToNPort(network), 0)!
    expect(
      noiseFigureFromCorrelation(network, 0, correlation, 50, 50),
    ).toBeCloseTo(3.01029995664, 10)
  })

  it('converts Fmin/GammaOpt/Rn into a source-dependent correlation matrix', () => {
    const network = createThroughNetwork(new Float64Array([1e9]), 50)
    const noise = {
      frequencyHz: new Float64Array([1e9]),
      minimumNoiseFigureDb: new Float64Array([1]),
      optimumSourceReflection: {
        re: new Float64Array([1 / 3]),
        im: new Float64Array([0]),
      },
      effectiveNoiseResistanceOhm: new Float64Array([10]),
    }
    const correlation = touchstoneNoiseCorrelationAt(
      network,
      0,
      noise,
      1e9,
      50,
    )!
    expect(
      noiseFigureFromCorrelation(network, 0, correlation, 100, 50),
    ).toBeCloseTo(1, 9)
    expect(
      noiseFigureFromCorrelation(network, 0, correlation, 50, 50),
    ).toBeGreaterThan(1)
  })
})
