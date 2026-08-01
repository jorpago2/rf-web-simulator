import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { simulateLinearChain } from './simulation'
import type { RFNodeType, RFProjectNode } from './types'

const throughText = readFileSync(
  new URL('../test/fixtures/ideal-through.s2p', import.meta.url),
  'utf8',
)

function node(
  id: string,
  type: RFNodeType,
  parameters: Record<string, unknown>,
): RFProjectNode {
  return { id, position: { x: 0, y: 0 }, data: { label: id, type, parameters } }
}

describe('RF simulation integration', () => {
  it('imports, clips, interpolates, and cascades a Touchstone through network', () => {
    const result = simulateLinearChain({
      analysis: {
        startHz: 0.5e9,
        stopHz: 2.5e9,
        points: 5,
        referenceImpedanceOhm: 50,
      },
      nodes: [
        node('src', 'source', {}),
        node('network', 'touchstone2Port', {
          content: throughText,
          fileName: 'ideal-through.s2p',
        }),
        node('load', 'load', { referenceImpedanceOhm: 50 }),
      ],
      edges: [
        { id: 'a', source: 'src', target: 'network' },
        { id: 'b', source: 'network', target: 'load' },
      ],
    })

    expect(result.total.frequencyHz[0]).toBe(1e9)
    expect(result.total.frequencyHz.at(-1)).toBe(2e9)
    expect(result.total.s21.re).toEqual(new Float64Array([1, 1, 1, 1, 1]))
    expect(result.curves.s21Db).toEqual(new Float64Array([0, 0, 0, 0, 0]))
    for (const groupDelaySeconds of result.curves.s21GroupDelayS) {
      expect(groupDelaySeconds).toBeCloseTo(0)
    }
    expect(result.warnings[0]?.code).toBe('RANGE_CLIPPED')
    expect(result.stageSummaries[0]?.s21DbAtCenter).toBeCloseTo(0)
    expect(result.probeResults).toEqual([])
    expect(
      [...result.total.s21.re, ...result.total.s21.im].every(Number.isFinite),
    ).toBe(true)
  })

  it('records cumulative S21 at each non-invasive probe plane', () => {
    const result = simulateLinearChain({
      analysis: {
        startHz: 1e9,
        stopHz: 2e9,
        points: 3,
        referenceImpedanceOhm: 50,
      },
      nodes: [
        node('src', 'source', { powerDbm: -30 }),
        node('amp', 'idealAmplifier', {
          gainDb: 10,
          phaseDeg: 0,
          noiseFigureDb: 2,
          outputP1Dbm: 20,
          outputIp3Dbm: 35,
          referenceImpedanceOhm: 50,
        }),
        node('probe-after-amp', 'probe', {}),
        node('attenuator', 'idealAttenuator', {
          attenuationDb: 3,
          phaseDeg: 0,
          referenceImpedanceOhm: 50,
        }),
        node('probe-after-attenuator', 'probe', {}),
        node('load', 'load', { referenceImpedanceOhm: 50 }),
      ],
      edges: [
        { id: 'a', source: 'src', target: 'amp' },
        { id: 'b', source: 'amp', target: 'probe-after-amp' },
        { id: 'c', source: 'probe-after-amp', target: 'attenuator' },
        { id: 'd', source: 'attenuator', target: 'probe-after-attenuator' },
        { id: 'e', source: 'probe-after-attenuator', target: 'load' },
      ],
    })

    expect(result.probeResults.map((probe) => probe.nodeId)).toEqual([
      'probe-after-amp',
      'probe-after-attenuator',
    ])
    for (const value of result.probeResults[0]!.s21Db) {
      expect(value).toBeCloseTo(10)
    }
    for (const value of result.probeResults[1]!.s21Db) {
      expect(value).toBeCloseTo(7)
    }
    expect(result.curves.s21Db[1]).toBeCloseTo(7)
    const budgetTotal = result.budget.stages.at(-1)!
    expect(budgetTotal.cumulativeGainDb).toBeCloseTo(7)
    expect(budgetTotal.outputPowerDbm).toBeCloseTo(-23)
    expect(budgetTotal.cumulativeNoiseFigureDb).toBeCloseTo(
      10 * Math.log10(10 ** 0.2 + (10 ** 0.3 - 1) / 10),
    )
    expect(budgetTotal.cumulativeOutputP1Dbm).toBeCloseTo(17)
    expect(budgetTotal.cumulativeOutputIp3Dbm).toBeCloseTo(32)
    expect(result.nonlinear.available).toBe(true)
    expect(result.nonlinear.inputP1Dbm).toBeCloseTo(11)
    expect(result.nonlinear.outputP1Dbm).toBeCloseTo(17)
    expect(result.nonlinear.outputIp3Dbm).toBeCloseTo(32)
    expect(result.nonlinear.operatingOutputPowerDbm).toBeCloseTo(-23)
    expect(result.nonlinear.limitingStageLabel).toBe('amp')
    expect(result.nonlinear.toneFrequenciesHz).toEqual([1.495e9, 1.505e9])
  })

  it('tracks an ideal downconversion envelope and frequency plan', () => {
    const result = simulateLinearChain({
      analysis: {
        startHz: 1e9,
        stopHz: 1.2e9,
        points: 3,
        referenceImpedanceOhm: 50,
      },
      nodes: [
        node('src', 'source', { powerDbm: -30 }),
        node('mixer', 'idealMixer', {
          loFrequencyHz: 0.9e9,
          mixerMode: 'downconvert',
          conversionLossDb: 7,
          loPowerDbm: 10,
          imageRejectionDb: 45,
          loToOutputIsolationDb: 35,
          noiseFigureDb: 7,
          outputP1Dbm: 10,
          outputIp3Dbm: 20,
          referenceImpedanceOhm: 50,
        }),
        node('if-amp', 'idealAmplifier', {
          gainDb: 10,
          phaseDeg: 0,
          noiseFigureDb: 2,
          outputP1Dbm: 20,
          outputIp3Dbm: 35,
          referenceImpedanceOhm: 50,
        }),
        node('load', 'load', { referenceImpedanceOhm: 50 }),
      ],
      edges: [
        { id: 'a', source: 'src', target: 'mixer' },
        { id: 'b', source: 'mixer', target: 'if-amp' },
        { id: 'c', source: 'if-amp', target: 'load' },
      ],
    })

    expect(result.curves.s21Db[1]).toBeCloseTo(3)
    expect(Number.isNaN(result.curves.s21PhaseDeg[1])).toBe(true)
    expect(Number.isNaN(result.curves.s21GroupDelayS[1])).toBe(true)
    expect(result.frequencyPlan.outputFrequencyHz).toEqual(
      new Float64Array([0.1e9, 0.2e9, 0.3e9]),
    )
    expect(result.frequencyPlan.stages[0]?.output.centerHz).toBe(0.2e9)
    expect(result.frequencyPlan.stages[0]?.imageFrequencyHz).toBe(0.7e9)
    expect(result.frequencyPlan.stages[0]?.estimatedLoLeakagePowerDbm).toBe(-25)
    expect(result.budget.stages.at(-1)?.cumulativeGainDb).toBeCloseTo(3)
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'FREQUENCY_CONVERSION_MODEL' }),
    )
  })

  it('evaluates a post-mixer Touchstone network on its translated grid', () => {
    const ifFilter = [
      '# GHz S RI R 50',
      '0.1 0 0 0.5 0 0 0 0 0',
      '0.3 0 0 1 0 0 0 0 0',
    ].join('\n')
    const result = simulateLinearChain({
      analysis: {
        startHz: 0.9e9,
        stopHz: 1.3e9,
        points: 3,
        referenceImpedanceOhm: 50,
      },
      nodes: [
        node('src', 'source', {}),
        node('mixer', 'idealMixer', {
          loFrequencyHz: 0.9e9,
          mixerMode: 'downconvert',
          conversionLossDb: 0,
          referenceImpedanceOhm: 50,
        }),
        node('if-filter', 'touchstone2Port', { content: ifFilter }),
        node('load', 'load', { referenceImpedanceOhm: 50 }),
      ],
      edges: [
        { id: 'a', source: 'src', target: 'mixer' },
        { id: 'b', source: 'mixer', target: 'if-filter' },
        { id: 'c', source: 'if-filter', target: 'load' },
      ],
    })

    expect(result.total.frequencyHz).toEqual(
      new Float64Array([1e9, 1.1e9, 1.2e9]),
    )
    expect(result.frequencyPlan.outputFrequencyHz).toEqual(
      new Float64Array([0.1e9, 0.2e9, 0.3e9]),
    )
    expect(result.total.s21.re).toEqual(new Float64Array([0.5, 0.75, 1]))
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'RANGE_CLIPPED' }),
    )
  })

  it('rejects mismatched reference impedances explicitly', () => {
    expect(() =>
      simulateLinearChain({
        analysis: {
          startHz: 1e9,
          stopHz: 2e9,
          points: 2,
          referenceImpedanceOhm: 50,
        },
        nodes: [
          node('src', 'source', {}),
          node('load', 'load', { referenceImpedanceOhm: 75 }),
        ],
        edges: [{ id: 'a', source: 'src', target: 'load' }],
      }),
    ).toThrow(/mismatch/u)
  })
})
