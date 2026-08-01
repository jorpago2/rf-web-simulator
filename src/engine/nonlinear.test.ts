import { describe, expect, it } from 'vitest'
import { calculateNonlinearSweep } from './nonlinear'
import type { RFBudgetResult } from './types'

function budget(): RFBudgetResult {
  return {
    centerFrequencyHz: 1e9,
    sourcePowerDbm: null,
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
    const result = calculateNonlinearSweep(budget())

    expect(result.available).toBe(true)
    expect(result.inputPowerDbm[75]).toBeCloseTo(1)
    expect(result.linearOutputPowerDbm[75]).toBeCloseTo(21)
    expect(result.compressedOutputPowerDbm[75]).toBeCloseTo(20)
    expect(result.im3OutputPowerDbm[75]).toBeCloseTo(3 * 21 - 2 * 29.586073)
  })

  it('remains unavailable when P1dB and IP3 metadata are absent', () => {
    const missing = budget()
    missing.stages[0]!.cumulativeInputP1Dbm = null
    missing.stages[0]!.cumulativeOutputP1Dbm = null
    missing.stages[0]!.cumulativeOutputIp3Dbm = null

    const result = calculateNonlinearSweep(missing)
    expect(result.available).toBe(false)
    expect(result.inputPowerDbm).toHaveLength(0)
  })
})
