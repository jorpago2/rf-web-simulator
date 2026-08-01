import { describe, expect, it } from 'vitest'
import { createIdealAmplifier, createThroughNetwork } from './idealNetworks'
import { calculateTransducerGain } from './transducer'

describe('transducer gain', () => {
  it('equals available gain for matched terminations', () => {
    const network = createIdealAmplifier(new Float64Array([1e9]), 10, 0, 50)
    expect(
      calculateTransducerGain(network, 0, 50, 50).transducerGainDb,
    ).toBeCloseTo(10, 12)
  })

  it('includes source and load mismatch for an ideal through', () => {
    const network = createThroughNetwork(new Float64Array([1e9]), 50)
    const result = calculateTransducerGain(network, 0, 25, 100)
    const expected =
      ((1 - result.sourceReflectionCoefficient ** 2) *
        (1 - result.loadReflectionCoefficient ** 2)) /
      (1 -
        result.sourceReflectionCoefficient *
          result.loadReflectionCoefficient) **
        2
    expect(result.transducerGainLinear).toBeCloseTo(expected, 12)
    expect(result.transducerGainLinear).toBeLessThan(1)
  })
})
