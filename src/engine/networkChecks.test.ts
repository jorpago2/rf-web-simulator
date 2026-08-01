import { describe, expect, it } from 'vitest'
import {
  createIdealAmplifier,
  createIdealAttenuator,
  createThroughNetwork,
} from './idealNetworks'
import { calculateNetworkChecks } from './networkChecks'

describe('two-port network checks', () => {
  it('detects active gain as non-passive', () => {
    const network = createIdealAmplifier(
      new Float64Array([1e9]),
      20 * Math.log10(2),
      0,
      50,
    )
    const checks = calculateNetworkChecks(network)
    expect(checks.passivityMaximumSingularValue[0]).toBeCloseTo(2, 10)
    expect(checks.stabilityK[0]).toBe(Number.POSITIVE_INFINITY)
  })

  it('recognizes a reciprocal passive attenuator', () => {
    const network = createIdealAttenuator(
      new Float64Array([1e9]),
      20 * Math.log10(2),
      0,
      50,
    )
    const checks = calculateNetworkChecks(network)
    expect(checks.passivityMaximumSingularValue[0]).toBeCloseTo(0.5, 10)
    expect(checks.reciprocityErrorMagnitude[0]).toBeCloseTo(0, 12)
  })

  it('separates a causal delay from a noncausal time advance over a uniform band', () => {
    const frequencyHz = Float64Array.from(
      { length: 32 },
      (_, index) => 1e9 + index * 10e6,
    )
    const delayed = createThroughNetwork(frequencyHz, 50)
    const advanced = createThroughNetwork(frequencyHz, 50)
    const delayS = 100e-9 / 31
    for (let index = 0; index < frequencyHz.length; index += 1) {
      const angle = 2 * Math.PI * frequencyHz[index]! * delayS
      delayed.s21.re[index] = delayed.s12.re[index] = Math.cos(-angle)
      delayed.s21.im[index] = delayed.s12.im[index] = Math.sin(-angle)
      advanced.s21.re[index] = advanced.s12.re[index] = Math.cos(angle)
      advanced.s21.im[index] = advanced.s12.im[index] = Math.sin(angle)
    }
    expect(
      calculateNetworkChecks(delayed).causalityPreEchoEnergyDb,
    ).toBeLessThan(-100)
    expect(
      calculateNetworkChecks(advanced).causalityPreEchoEnergyDb,
    ).toBeGreaterThan(-0.1)
  })

  it('keeps a 1,001-point uniform grid uniform when limiting transform size', () => {
    const network = createThroughNetwork(
      Float64Array.from({ length: 1001 }, (_, index) => 0.8e9 + index * 0.4e6),
      50,
    )
    const checks = calculateNetworkChecks(network)
    expect(checks.causalityPreEchoEnergyDb).toBeLessThan(-200)
    expect(checks.causalityTimeResolutionS).toBeGreaterThan(0)
  })
})
