import { describe, expect, it } from 'vitest'
import { calculateRFBudget, type BudgetStageInput } from './budget'
import { calculateNonlinearSweep } from './nonlinear'
import type { RFBudgetResult } from './types'

const amplifier: BudgetStageInput = {
  nodeId: 'amp',
  label: 'Amplifier',
  type: 'idealAmplifier',
  gainDb: 20,
  noiseFigureDb: 3,
  outputP1Dbm: 20,
  outputIp3Dbm: 30,
}

function budget(): RFBudgetResult {
  return {
    centerFrequencyHz: 1e9,
    sourcePowerDbm: null,
    sourceImpedanceOhm: 50,
    loadImpedanceOhm: 50,
    transducerGainDb: 20,
    deliveredLoadPowerDbm: null,
    cascadedNoiseFigureDb: 3,
    stages: [
      {
        nodeId: 'amp',
        label: 'Amplifier',
        type: 'idealAmplifier',
        stageGainDb: 20,
        cumulativeGainDb: 20,
        outputPowerDbm: null,
        cumulativeNoiseFigureDb: 3,
        cumulativeInputP1Dbm: 1,
        cumulativeOutputP1Dbm: 20,
        cumulativeInputIp3Dbm: 9.586073,
        cumulativeOutputIp3Dbm: 29.586073,
      },
    ],
    warnings: [],
  }
}

describe('chain-level nonlinear sweep', () => {
  it('is calibrated to P1dB and the two-tone IP3 intercept', () => {
    const result = calculateNonlinearSweep(budget(), [amplifier])

    expect(result.available).toBe(true)
    expect(result.inputPowerDbm[75]).toBeCloseTo(1)
    expect(result.linearOutputPowerDbm[75]).toBeCloseTo(21)
    expect(result.compressedOutputPowerDbm[75]).toBeCloseTo(20)
    expect(result.im3OutputPowerDbm[75]).toBeCloseTo(3 * 21 - 2 * 30)
    expect(result.toneFrequenciesHz).toEqual([995e6, 1005e6])
    expect(result.im3FrequenciesHz).toEqual([985e6, 1015e6])
    expect(result.limitingStageLabel).toBe('Amplifier')
    const fundamental = result.envelopeSpectrum.find((line) => line.index === 1)
    const im3 = result.envelopeSpectrum.find((line) => line.index === 3)
    expect(fundamental).toBeDefined()
    expect(im3?.outputPowerDbm).toBeLessThan(fundamental!.outputPowerDbm)
  })

  it('propagates compression through every stage', () => {
    const stages: BudgetStageInput[] = [
      { ...amplifier, outputP1Dbm: 30 },
      {
        ...amplifier,
        nodeId: 'amp-2',
        label: 'Output amplifier',
        outputP1Dbm: 20,
      },
    ]
    const result = calculateNonlinearSweep(
      calculateRFBudget(1e9, -30, stages),
      stages,
      1e9,
      20e6,
    )

    expect(result.inputP1Dbm).toBeLessThan(-19)
    expect(result.outputP1Dbm).toBeCloseTo(result.inputP1Dbm! + 39)
    expect(result.limitingStageLabel).toBe('Output amplifier')
    expect(result.toneFrequenciesHz).toEqual([990e6, 1010e6])
    expect(result.im3FrequenciesHz).toEqual([970e6, 1030e6])
  })

  it('remains unavailable when P1dB and IP3 metadata are absent', () => {
    const missing = budget()
    missing.stages[0]!.cumulativeInputP1Dbm = null
    missing.stages[0]!.cumulativeOutputP1Dbm = null
    missing.stages[0]!.cumulativeOutputIp3Dbm = null

    const result = calculateNonlinearSweep(missing, [
      { ...amplifier, outputP1Dbm: null, outputIp3Dbm: null },
    ])
    expect(result.available).toBe(false)
    expect(result.inputPowerDbm).toHaveLength(0)
  })

  it('coherently combines stage IM3 phase', () => {
    const stages: BudgetStageInput[] = [
      { ...amplifier, gainDb: 0, outputIp3Dbm: 20, im3PhaseDeg: 0 },
      {
        ...amplifier,
        nodeId: 'amp-2',
        gainDb: 0,
        outputIp3Dbm: 20,
        im3PhaseDeg: 180,
      },
    ]
    const result = calculateNonlinearSweep(
      calculateRFBudget(1e9, -30, stages),
      stages,
    )
    expect(result.outputIp3Dbm).toBe(Number.POSITIVE_INFINITY)
    expect(Array.from(result.im3OutputPowerDbm)).toContain(
      Number.NEGATIVE_INFINITY,
    )
  })
})
