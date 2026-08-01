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
  it('cascades filter, phase-shifter, and isolator blocks', () => {
    const result = simulateLinearChain({
      analysis: {
        startHz: 0.8e9,
        stopHz: 1.2e9,
        points: 3,
        referenceImpedanceOhm: 50,
      },
      nodes: [
        node('src', 'source', {
          powerDbm: -10,
          sourceImpedanceOhm: 50,
        }),
        node('filter', 'idealFilter', {
          filterType: 'bandpass',
          cutoffFrequencyHz: 1e9,
          centerFrequencyHz: 1e9,
          bandwidthHz: 0.2e9,
          order: 3,
          insertionLossDb: 1,
          referenceImpedanceOhm: 50,
        }),
        node('phase', 'idealPhaseShifter', {
          phaseDeg: 90,
          insertionLossDb: 1,
          referenceImpedanceOhm: 50,
        }),
        node('isolator', 'idealIsolator', {
          forwardLossDb: 1,
          reverseIsolationDb: 30,
          phaseDeg: 0,
          referenceImpedanceOhm: 50,
        }),
        node('load', 'load', {
          referenceImpedanceOhm: 50,
          loadImpedanceOhm: 50,
        }),
      ],
      edges: [
        { id: 'a', source: 'src', target: 'filter' },
        { id: 'b', source: 'filter', target: 'phase' },
        { id: 'c', source: 'phase', target: 'isolator' },
        { id: 'd', source: 'isolator', target: 'load' },
      ],
    })

    expect(result.curves.s21Db[1]).toBeCloseTo(-3, 10)
    expect(result.curves.s12Db[1]).toBeCloseTo(-32, 10)
    expect(result.curves.s21PhaseDeg[1]).toBeCloseTo(90, 10)
    expect(result.budget.cascadedNoiseFigureDb).toBeCloseTo(3, 8)
  })

  it('uses tabulated datasheet performance for an active amplifier', () => {
    const deviceTableContent = `frequency_ghz,gain_db,nf_db,oip3_dbm,pin_dbm,pout_dbm
1,20,2,35,,
2,18,4,31,,
1,,,,-20,0
1,,,,-10,9.8
1,,,,0,18
2,,,,-20,-2
2,,,,-10,7.5
2,,,,0,16`
    const result = simulateLinearChain({
      analysis: {
        startHz: 1e9,
        stopHz: 2e9,
        points: 3,
        referenceImpedanceOhm: 50,
      },
      nodes: [
        node('src', 'source', { powerDbm: -10 }),
        node('amp', 'idealAmplifier', {
          gainDb: 10,
          phaseDeg: 0,
          noiseFigureDb: 9,
          outputP1Dbm: 9,
          outputIp3Dbm: 9,
          referenceImpedanceOhm: 50,
          deviceTableContent,
          deviceTableFileName: 'measured.csv',
        }),
        node('load', 'load', { referenceImpedanceOhm: 50 }),
      ],
      edges: [
        { id: 'a', source: 'src', target: 'amp' },
        { id: 'b', source: 'amp', target: 'load' },
      ],
    })

    expect(result.curves.s21Db[0]).toBeCloseTo(20)
    expect(result.curves.s21Db[1]).toBeCloseTo(19)
    expect(result.curves.s21Db[2]).toBeCloseTo(18)
    expect(result.budget.stages[0]!.cumulativeNoiseFigureDb).toBeCloseTo(3)
    expect(result.budget.stages[0]!.cumulativeOutputIp3Dbm).toBeCloseTo(33)
    expect(result.nonlinear.operatingOutputPowerDbm).toBeCloseTo(8.65)
    expect(result.nonlinear.outputP1Dbm).toBeCloseTo(11.9394, 3)
  })

  it('uses analytic gain when a partial device table has no gain column', () => {
    const result = simulateLinearChain({
      analysis: {
        startHz: 1e9,
        stopHz: 2e9,
        points: 3,
        referenceImpedanceOhm: 50,
      },
      nodes: [
        node('src', 'source', { powerDbm: -10 }),
        node('amp', 'idealAmplifier', {
          gainDb: 12,
          phaseDeg: 0,
          noiseFigureDb: 9,
          outputP1Dbm: 20,
          outputIp3Dbm: 35,
          referenceImpedanceOhm: 50,
          deviceTableContent: `frequency_ghz,nf_db
1,2
2,4`,
          deviceTableFileName: 'noise-figure.csv',
        }),
        node('load', 'load', { referenceImpedanceOhm: 50 }),
      ],
      edges: [
        { id: 'a', source: 'src', target: 'amp' },
        { id: 'b', source: 'amp', target: 'load' },
      ],
    })

    expect(result.curves.s21Db).toEqual(new Float64Array([12, 12, 12]))
    expect(result.budget.stages[0]!.cumulativeNoiseFigureDb).toBeCloseTo(3)
  })

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

  it('solves coherent splitter and combiner branches as an N-port network', () => {
    const dividerParameters = {
      excessLossDb: 0,
      amplitudeImbalanceDb: 0,
      phaseImbalanceDeg: 0,
      isolationDb: 300,
      referenceImpedanceOhm: 50,
    }
    const result = simulateLinearChain({
      analysis: {
        startHz: 1e9,
        stopHz: 2e9,
        points: 3,
        referenceImpedanceOhm: 50,
      },
      nodes: [
        node('src', 'source', { powerDbm: -10, twoToneSpacingHz: 10e6 }),
        node('split', 'idealSplitter', dividerParameters),
        node('combine', 'idealCombiner', dividerParameters),
        node('load', 'load', { referenceImpedanceOhm: 50 }),
      ],
      edges: [
        {
          id: 'source-split',
          source: 'src',
          target: 'split',
          targetHandle: 'input',
        },
        {
          id: 'branch-a',
          source: 'split',
          sourceHandle: 'output-1',
          target: 'combine',
          targetHandle: 'input-1',
        },
        {
          id: 'branch-b',
          source: 'split',
          sourceHandle: 'output-2',
          target: 'combine',
          targetHandle: 'input-2',
        },
        {
          id: 'combine-load',
          source: 'combine',
          sourceHandle: 'output',
          target: 'load',
        },
      ],
    })

    expect(result.curves.s21Db[1]).toBeCloseTo(0, 10)
    expect(result.curves.s11Db[1]).toBe(-300)
    expect(result.budget.cascadedNoiseFigureDb).toBeCloseTo(0, 10)
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'BRANCHED_NETWORK_MODEL' }),
    )
  })

  it('recombines branched mixer envelopes only at a common output band', () => {
    const divider = {
      excessLossDb: 0,
      amplitudeImbalanceDb: 0,
      phaseImbalanceDeg: 0,
      isolationDb: 300,
      referenceImpedanceOhm: 50,
    }
    const mixer = {
      loFrequencyHz: 0.5e9,
      mixerMode: 'downconvert',
      conversionLossDb: 0,
      noiseFigureDb: 0,
      outputP1Dbm: 10,
      outputIp3Dbm: 20,
      referenceImpedanceOhm: 50,
    }
    const result = simulateLinearChain({
      analysis: {
        startHz: 1e9,
        stopHz: 2e9,
        points: 3,
        referenceImpedanceOhm: 50,
      },
      nodes: [
        node('src', 'source', { powerDbm: -10 }),
        node('split', 'idealSplitter', divider),
        node('mix-a', 'idealMixer', mixer),
        node('mix-b', 'idealMixer', mixer),
        node('combine', 'idealCombiner', divider),
        node('load', 'load', { referenceImpedanceOhm: 50 }),
      ],
      edges: [
        { id: 'a', source: 'src', target: 'split', targetHandle: 'input' },
        { id: 'b', source: 'split', sourceHandle: 'output-1', target: 'mix-a' },
        { id: 'c', source: 'split', sourceHandle: 'output-2', target: 'mix-b' },
        {
          id: 'd',
          source: 'mix-a',
          target: 'combine',
          targetHandle: 'input-1',
        },
        {
          id: 'e',
          source: 'mix-b',
          target: 'combine',
          targetHandle: 'input-2',
        },
        { id: 'f', source: 'combine', sourceHandle: 'output', target: 'load' },
      ],
    })
    expect(result.curves.s21Db[1]).toBeCloseTo(0, 10)
    expect(result.frequencyPlan.output.centerHz).toBe(1e9)
    expect(result.nonlinear.available).toBe(true)
    expect(result.nonlinear.inputP1Dbm).toBeGreaterThan(13)
  })

  it('reports internal probe waves in a branched graph', () => {
    const divider = {
      excessLossDb: 0,
      amplitudeImbalanceDb: 0,
      phaseImbalanceDeg: 0,
      isolationDb: 300,
      referenceImpedanceOhm: 50,
    }
    const result = simulateLinearChain({
      analysis: {
        startHz: 1e9,
        stopHz: 2e9,
        points: 3,
        referenceImpedanceOhm: 50,
      },
      nodes: [
        node('src', 'source', {}),
        node('split', 'idealSplitter', divider),
        node('probe', 'probe', {}),
        node('combine', 'idealCombiner', divider),
        node('load', 'load', { referenceImpedanceOhm: 50 }),
      ],
      edges: [
        { id: 'a', source: 'src', target: 'split', targetHandle: 'input' },
        {
          id: 'b',
          source: 'split',
          sourceHandle: 'output-1',
          target: 'probe',
        },
        {
          id: 'c',
          source: 'probe',
          target: 'combine',
          targetHandle: 'input-1',
        },
        {
          id: 'd',
          source: 'split',
          sourceHandle: 'output-2',
          target: 'combine',
          targetHandle: 'input-2',
        },
        { id: 'e', source: 'combine', sourceHandle: 'output', target: 'load' },
      ],
    })
    expect(result.curves.s21Db[1]).toBeCloseTo(0, 10)
    expect(result.probeResults[0]?.s21Db[1]).toBeCloseTo(-3.01029995664, 8)
  })

  it('de-embeds independent input and output fixtures before cascading', () => {
    const fixture =
      '# GHz S RI R 50\n1 0 0 0.5 0 0.5 0 0 0\n2 0 0 0.5 0 0.5 0 0 0'
    const measured =
      '# GHz S RI R 50\n1 0 0 0.125 0 0.125 0 0 0\n2 0 0 0.125 0 0.125 0 0 0'
    const result = simulateLinearChain({
      analysis: {
        startHz: 1e9,
        stopHz: 2e9,
        points: 3,
        referenceImpedanceOhm: 50,
      },
      nodes: [
        node('src', 'source', { powerDbm: -10, sourceImpedanceOhm: 50 }),
        node('dut', 'touchstone2Port', {
          content: measured,
          fileName: 'measured.s2p',
          leftFixtureContent: fixture,
          leftFixtureFileName: 'left.s2p',
          rightFixtureContent: fixture,
          rightFixtureFileName: 'right.s2p',
        }),
        node('load', 'load', {
          referenceImpedanceOhm: 50,
          loadImpedanceOhm: 50,
        }),
      ],
      edges: [
        { id: 'a', source: 'src', target: 'dut' },
        { id: 'b', source: 'dut', target: 'load' },
      ],
    })

    expect(result.total.s21.re[1]).toBeCloseTo(0.5, 10)
  })

  it('runs reproducible Gaussian tolerance analysis', () => {
    const input = {
      analysis: {
        startHz: 1e9,
        stopHz: 2e9,
        points: 3,
        referenceImpedanceOhm: 50,
        monteCarloRuns: 20,
        monteCarloSeed: 1234,
      },
      nodes: [
        node('src', 'source', {
          powerDbm: -20,
          twoToneSpacingHz: 10e6,
          sourceImpedanceOhm: 50,
        }),
        node('amp', 'idealAmplifier', {
          gainDb: 10,
          gainToleranceDb: 1,
          phaseDeg: 0,
          noiseFigureDb: 2,
          outputP1Dbm: 20,
          outputIp3Dbm: 35,
          referenceImpedanceOhm: 50,
        }),
        node('load', 'load', {
          referenceImpedanceOhm: 50,
          loadImpedanceOhm: 50,
        }),
      ],
      edges: [
        { id: 'a', source: 'src', target: 'amp' },
        { id: 'b', source: 'amp', target: 'load' },
      ],
    }
    const first = simulateLinearChain(input)
    const second = simulateLinearChain(input)
    expect(first.monteCarlo).toEqual(second.monteCarlo)
    expect(first.monteCarlo.runs).toBe(20)
    expect(
      first.monteCarlo.metrics.find((metric) => metric.key === 's21Db')
        ?.standardDeviation,
    ).toBeGreaterThan(0)
    expect(
      first.monteCarlo.sensitivities.find((item) => item.metricKey === 's21Db')
        ?.correlation,
    ).toBeCloseTo(1, 10)

    const sweep = simulateLinearChain({
      ...input,
      analysis: {
        ...input.analysis,
        monteCarloRuns: 0,
        sweepNodeId: 'amp',
        sweepParameter: 'gainDb',
        sweepStart: 8,
        sweepStop: 12,
        sweepPoints: 3,
        sweepMetric: 's21Db',
        sweepObjective: 'maximize',
      },
    }).parametricSweep
    expect(sweep.metricValues).toEqual(new Float64Array([8, 10, 12]))
    expect(sweep.bestParameterValue).toBe(12)

    expect(() =>
      simulateLinearChain({
        ...input,
        nodes: input.nodes.map((candidate) =>
          candidate.id === 'amp'
            ? {
                ...candidate,
                data: {
                  ...candidate.data,
                  parameters: {
                    ...candidate.data.parameters,
                    deviceTableContent: 'frequency_ghz,gain_db\n1,19\n2,19',
                  },
                },
              }
            : candidate,
        ),
        analysis: {
          ...input.analysis,
          monteCarloRuns: 0,
          sweepNodeId: 'amp',
          sweepParameter: 'gainDb',
          sweepStart: 8,
          sweepStop: 12,
          sweepPoints: 3,
          sweepMetric: 's21Db',
          sweepObjective: 'maximize',
        },
      }),
    ).toThrow('imported measured data overrides that fallback parameter')

    const constrained = simulateLinearChain({
      ...input,
      analysis: {
        ...input.analysis,
        monteCarloRuns: 0,
        sweepNodeId: 'amp',
        sweepParameter: 'gainDb',
        sweepStart: 8,
        sweepStop: 12,
        sweepPoints: 3,
        sweepSecondNodeId: 'src',
        sweepSecondParameter: 'powerDbm',
        sweepSecondStart: -30,
        sweepSecondStop: -10,
        sweepSecondPoints: 3,
        sweepMetric: 'loadPowerDbm',
        sweepObjective: 'maximize',
        sweepConstraintMetric: 'noiseFigureDb',
        sweepConstraintDirection: 'maximum',
        sweepConstraintValue: 2.1,
      },
    }).parametricSweep
    expect(constrained.samples).toHaveLength(9)
    expect(constrained.bestParameterValues).toEqual([12, -10])
    expect(constrained.bestMetricValue).toBeCloseTo(2)

    const yieldResult = simulateLinearChain({
      ...input,
      analysis: {
        ...input.analysis,
        sweepConstraintMetric: 'noiseFigureDb',
        sweepConstraintDirection: 'maximum',
        sweepConstraintValue: 2.1,
      },
    }).monteCarlo
    expect(yieldResult.yieldPercent).toBe(100)
    expect(yieldResult.passingRuns).toBe(20)
  })

  it('uses source-dependent Touchstone noise parameters and mismatch gain', () => {
    const content = `[Version] 2.0
# GHz S RI R 50
[Number of Ports] 2
[Number of Frequencies] 2
[Number of Noise Frequencies] 2
[Two-Port Data Order] 21_12
[Network Data]
1 0 0 1 0 1 0 0 0
2 0 0 1 0 1 0 0 0
[Noise Data]
1 1 0.3333333333333333 0 10
2 1 0.3333333333333333 0 10
[End]`
    const result = simulateLinearChain({
      analysis: {
        startHz: 1e9,
        stopHz: 2e9,
        points: 3,
        referenceImpedanceOhm: 50,
      },
      nodes: [
        node('src', 'source', { powerDbm: 0, sourceImpedanceOhm: 100 }),
        node('dut', 'touchstone2Port', {
          content,
          fileName: 'noise.s2p',
        }),
        node('load', 'load', {
          referenceImpedanceOhm: 50,
          loadImpedanceOhm: 50,
        }),
      ],
      edges: [
        { id: 'a', source: 'src', target: 'dut' },
        { id: 'b', source: 'dut', target: 'load' },
      ],
    })
    expect(result.budget.stages[0]?.cumulativeNoiseFigureDb).toBeCloseTo(1, 10)
    expect(result.budget.cascadedNoiseFigureDb).toBeCloseTo(1, 9)
    expect(result.budget.stages[0]?.cumulativeGainDb).toBeCloseTo(
      10 * Math.log10(8 / 9),
      10,
    )
    expect(result.budget.deliveredLoadPowerDbm).toBeCloseTo(
      10 * Math.log10(8 / 9),
      10,
    )
  })

  it('applies opt-in passivity enforcement to imported data', () => {
    const content = '# GHz S RI R 50\n1 0 0 2 0 0 0 0 0\n2 0 0 2 0 0 0 0 0'
    const result = simulateLinearChain({
      analysis: {
        startHz: 1e9,
        stopHz: 2e9,
        points: 3,
        referenceImpedanceOhm: 50,
      },
      nodes: [
        node('src', 'source', {}),
        node('dut', 'touchstone2Port', {
          content,
          fileName: 'active.s2p',
          enforcePassivity: true,
        }),
        node('load', 'load', { referenceImpedanceOhm: 50 }),
      ],
      edges: [
        { id: 'a', source: 'src', target: 'dut' },
        { id: 'b', source: 'dut', target: 'load' },
      ],
    })
    expect(result.curves.s21Db[1]).toBeCloseTo(0, 10)
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'PASSIVITY_ENFORCED' }),
    )
  })
})
