import { describe, expect, it } from 'vitest'
import { calculateRFBudget, type BudgetStageInput } from './budget'

const amplifier = (
  nodeId: string,
  gainDb: number,
  noiseFigureDb: number,
  outputP1Dbm: number,
  outputIp3Dbm: number,
): BudgetStageInput => ({
  nodeId,
  label: nodeId,
  type: 'idealAmplifier',
  gainDb,
  noiseFigureDb,
  outputP1Dbm,
  outputIp3Dbm,
})

describe('matched RF cascade budget', () => {
  it('applies Friis, conservative P1dB, and reciprocal IP3 formulas', () => {
    const result = calculateRFBudget(1e9, -30, [
      amplifier('amp-1', 10, 3, 20, 30),
      amplifier('amp-2', 10, 3, 20, 30),
    ])
    const total = result.stages.at(-1)!

    expect(total.cumulativeGainDb).toBeCloseTo(20)
    expect(total.outputPowerDbm).toBeCloseTo(-10)
    expect(total.cumulativeNoiseFigureDb).toBeCloseTo(
      10 * Math.log10(10 ** 0.3 + (10 ** 0.3 - 1) / 10),
    )
    expect(total.cumulativeInputP1Dbm).toBeCloseTo(1)
    expect(total.cumulativeOutputP1Dbm).toBeCloseTo(20)
    expect(total.cumulativeInputIp3Dbm).toBeCloseTo(
      10 * Math.log10(1 / (1 / 100 + 10 / 100)),
    )
    expect(total.cumulativeOutputIp3Dbm).toBeCloseTo(29.586073, 5)
    expect(result.warnings).toEqual([])
  })

  it('propagates unavailable metadata instead of inventing values', () => {
    const result = calculateRFBudget(1e9, null, [
      {
        nodeId: 'measured',
        label: 'Measured S2P',
        type: 'touchstone2Port',
        gainDb: -2,
        noiseFigureDb: null,
        outputP1Dbm: null,
        outputIp3Dbm: null,
      },
    ])

    expect(result.stages[0]?.cumulativeGainDb).toBeCloseTo(-2)
    expect(result.stages[0]?.outputPowerDbm).toBeNull()
    expect(result.stages[0]?.cumulativeNoiseFigureDb).toBeNull()
    expect(
      result.warnings.some((warning) => /NF, P1dB, IP3/u.test(warning)),
    ).toBe(true)
  })

  it('warns when the linear signal estimate reaches compression', () => {
    const result = calculateRFBudget(1e9, 10, [amplifier('amp', 10, 2, 20, 35)])
    expect(
      result.warnings.some((warning) =>
        /linear budget is invalid/u.test(warning),
      ),
    ).toBe(true)
  })
})
