import { expect, it } from 'vitest'
import { calculateAntenna, calculateOscillatorNoise } from './rfSources'
import type { RFBudgetResult, RFNodeType, RFProjectNode } from './types'

function node(
  type: RFNodeType,
  parameters: Record<string, unknown>,
): RFProjectNode {
  return {
    id: type,
    position: { x: 0, y: 0 },
    data: { label: type, type, parameters },
  }
}

it('blends VCO and reference phase noise through a first-order PLL', () => {
  const source = node('vcoSource', {
    freeRunningFrequencyHz: 1e9,
    tuningSensitivityHzPerV: 100e6,
    controlVoltageV: 0,
    phaseNoiseAt1MHzDbcHz: -120,
    phaseNoiseSlopeDbPerDecade: -20,
    phaseNoiseFloorDbcHz: -160,
    phaseNoiseIntegrationStartHz: 100,
    phaseNoiseIntegrationStopHz: 10e6,
    pllEnabled: true,
    pllLoopBandwidthHz: 100e3,
    pllInBandPhaseNoiseDbcHz: -140,
  })
  const result = calculateOscillatorNoise(source)
  const at1MHz = Array.from(result.offsetFrequencyHz).findIndex(
    (offset) => Math.abs(offset - 1e6) < 1,
  )

  expect(result.freeRunningDbcHz[at1MHz]).toBeCloseTo(-120, 8)
  expect(result.outputDbcHz[0]).toBeLessThan(result.freeRunningDbcHz[0]!)
  expect(result.outputDbcHz.at(-1)).toBeCloseTo(
    result.freeRunningDbcHz.at(-1)!,
    2,
  )
  expect(result.integratedPhaseErrorDeg).toBeGreaterThan(0)
  expect(result.rmsJitterS).toBeGreaterThan(0)
})

it('derives antenna directivity, realized gain, EIRP and rear level', () => {
  const source = node('source', {})
  const load = node('txAntenna', {
    efficiencyPercent: 50,
    patternExponent: 2,
    frontToBackDb: 20,
  })
  const budget = {
    centerFrequencyHz: 1e9,
    deliveredLoadPowerDbm: 10,
  } as RFBudgetResult
  const result = calculateAntenna(source, load, budget)

  expect(result.directivityDbi).toBeCloseTo(10 * Math.log10(6 / 1.01), 10)
  expect(result.realizedGainDbi).toBeCloseTo(result.directivityDbi! - 3.0103, 4)
  expect(result.eirpDbm).toBeCloseTo(10 + result.realizedGainDbi!, 10)
  expect(result.normalizedPatternDb[180]).toBeCloseTo(0, 10)
  expect(result.normalizedPatternDb[360]).toBeCloseTo(-20, 10)
  expect(result.effectiveApertureM2).toBeGreaterThan(0)
})
