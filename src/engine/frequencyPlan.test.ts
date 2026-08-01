import { describe, expect, it } from 'vitest'
import { calculateFrequencyPlan } from './frequencyPlan'

describe('ideal mixer frequency plan', () => {
  it('tracks difference then sum conversion in hertz', () => {
    const result = calculateFrequencyPlan(
      new Float64Array([1e9, 1.1e9, 1.2e9]),
      [
        {
          nodeId: 'down',
          label: 'RF to IF',
          mode: 'downconvert',
          loFrequencyHz: 0.9e9,
          conversionLossDb: 7,
          loPowerDbm: 10,
          imageRejectionDb: 40,
          loToOutputIsolationDb: 30,
          productModels: [
            {
              inputCoefficient: 2,
              loCoefficient: -1,
              relativeLevelDb: -38,
              phaseDeg: -12,
            },
          ],
        },
        {
          nodeId: 'up',
          label: 'IF to RF',
          mode: 'upconvert',
          loFrequencyHz: 2e9,
        },
      ],
      -10,
    )

    expect(result.stages[0]?.output).toEqual({
      startHz: 0.1e9,
      centerHz: 0.2e9,
      stopHz: 0.3e9,
    })
    expect(result.stages[0]?.imageFrequencyHz).toBe(0.7e9)
    expect(result.stages[0]?.imageLocation).toBe('input')
    expect(result.stages[0]?.imageRejectionDb).toBe(40)
    expect(result.stages[0]?.estimatedLoLeakagePowerDbm).toBe(-20)
    expect(
      result.stages[0]?.products.find(
        (product) => product.formula === '|fIN - fLO|',
      ),
    ).toEqual(
      expect.objectContaining({
        frequencyHz: 0.2e9,
        order: 2,
        kind: 'desired',
        relativeLevelDb: -7,
      }),
    )
    expect(
      result.stages[0]?.products.find(
        (product) =>
          product.inputCoefficient === 2 && product.loCoefficient === -1,
      ),
    ).toEqual(expect.objectContaining({ relativeLevelDb: -38, phaseDeg: -12 }))
    expect(result.stages[1]?.imageFrequencyHz).toBe(1.8e9)
    expect(result.stages[1]?.imageLocation).toBe('output')
    expect(result.outputFrequencyHz).toEqual(
      new Float64Array([2.1e9, 2.2e9, 2.3e9]),
    )
    expect(result.spectralLines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ frequencyHz: 2.2e9, powerDbm: -17 }),
        expect.objectContaining({ frequencyHz: 3.3e9, powerDbm: -48 }),
      ]),
    )
  })

  it('rejects a difference product at or below zero frequency', () => {
    expect(() =>
      calculateFrequencyPlan(new Float64Array([0.8e9, 1e9]), [
        {
          nodeId: 'mixer',
          label: 'Mixer',
          mode: 'downconvert',
          loFrequencyHz: 0.9e9,
        },
      ]),
    ).toThrow(/exceed the LO/u)
  })
})
