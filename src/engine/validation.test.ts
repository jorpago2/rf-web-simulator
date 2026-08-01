import { describe, expect, it } from 'vitest'
import type { RFProjectEdge, RFProjectNode, RFNodeType } from './types'
import { validateLinearGraph } from './validation'

function node(
  id: string,
  type: RFNodeType,
  parameters: Record<string, unknown> = {},
): RFProjectNode {
  return {
    id,
    position: { x: 0, y: 0 },
    data: { label: id, type, parameters },
  }
}

function edge(source: string, target: string): RFProjectEdge {
  return { id: `${source}-${target}`, source, target }
}

describe('linear RF graph validation', () => {
  it('returns the unique source-to-load order', () => {
    const result = validateLinearGraph(
      [
        node('load', 'load'),
        node('amp', 'idealAmplifier'),
        node('src', 'source'),
      ],
      [edge('src', 'amp'), edge('amp', 'load')],
    )

    expect(result.valid).toBe(true)
    expect(result.orderedNodeIds).toEqual(['src', 'amp', 'load'])
  })

  it('rejects branches, cycles, and disconnected blocks', () => {
    const result = validateLinearGraph(
      [
        node('src', 'source'),
        node('a', 'idealAmplifier'),
        node('b', 'probe'),
        node('load', 'load'),
      ],
      [edge('src', 'a'), edge('a', 'b'), edge('a', 'load'), edge('b', 'a')],
    )

    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['INVALID_PORT_DEGREE', 'CYCLE']),
    )
  })

  it('requires a parseable Touchstone asset', () => {
    const result = validateLinearGraph(
      [
        node('src', 'source'),
        node('s2p', 'touchstone2Port', { content: 'not numeric' }),
        node('load', 'load'),
      ],
      [edge('src', 's2p'), edge('s2p', 'load')],
    )

    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'INVALID_TOUCHSTONE', nodeId: 's2p' }),
    )
  })
})
