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
        },
        {
          nodeId: 'up',
          label: 'IF to RF',
          mode: 'upconvert',
          loFrequencyHz: 2e9,
        },
      ],
    )

    expect(result.stages[0]?.output).toEqual({
      startHz: 0.1e9,
      centerHz: 0.2e9,
      stopHz: 0.3e9,
    })
    expect(result.outputFrequencyHz).toEqual(
      new Float64Array([2.1e9, 2.2e9, 2.3e9]),
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
