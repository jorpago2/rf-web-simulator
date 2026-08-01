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
    expect(result.warnings[0]?.code).toBe('RANGE_CLIPPED')
    expect(result.stageSummaries[0]?.s21DbAtCenter).toBeCloseTo(0)
    expect(
      [...result.total.s21.re, ...result.total.s21.im].every(Number.isFinite),
    ).toBe(true)
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
