import { describe, expect, it } from 'vitest'
import { cascadeTwoPorts } from './cascade'
import { createIdealAttenuator } from './idealNetworks'
import {
  deembedTwoPortNetwork,
  invertTwoPortNetwork,
  twoPortParametersAt,
} from './twoPortParameters'

describe('two-port parameter conversion and de-embedding', () => {
  it('converts a matched attenuator to finite Z, Y, and ABCD matrices', () => {
    const network = createIdealAttenuator(new Float64Array([1e9]), 3, 20, 50)
    const parameters = twoPortParametersAt(network, 0)
    expect(parameters.z).toHaveLength(4)
    expect(parameters.y).toHaveLength(4)
    expect(parameters.abcd).toHaveLength(4)
    expect(parameters.z.every((value) => Number.isFinite(value.re))).toBe(true)
  })

  it('cascades a fixture with its inverse to an ideal through', () => {
    const fixture = createIdealAttenuator(
      new Float64Array([1e9, 2e9]),
      3,
      35,
      50,
    )
    const result = cascadeTwoPorts(
      fixture,
      invertTwoPortNetwork(fixture),
    ).network
    expect(result.s21.re[0]).toBeCloseTo(1, 11)
    expect(result.s21.im[0]).toBeCloseTo(0, 11)
    expect(result.s11.re[0]).toBeCloseTo(0, 11)
  })

  it('removes independently supplied left and right fixtures', () => {
    const frequencyHz = new Float64Array([1e9, 2e9])
    const left = createIdealAttenuator(frequencyHz, 1, 15, 50)
    const device = createIdealAttenuator(frequencyHz, 4, -20, 50)
    const right = createIdealAttenuator(frequencyHz, 2, 35, 50)
    const measured = cascadeTwoPorts(
      cascadeTwoPorts(left, device).network,
      right,
    ).network
    const result = deembedTwoPortNetwork(measured, left, right)
    expect(result.s21.re[0]).toBeCloseTo(device.s21.re[0]!, 10)
    expect(result.s21.im[0]).toBeCloseTo(device.s21.im[0]!, 10)
  })
})
