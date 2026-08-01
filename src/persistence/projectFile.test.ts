import { describe, expect, it } from 'vitest'
import type { RFProject } from '../engine/types'
import {
  parseProjectJson,
  ProjectFileError,
  serializeProject,
} from './projectFile'

const project: RFProject = {
  schemaVersion: 3,
  name: 'LNA chain',
  analysis: {
    startHz: 0.8e9,
    stopHz: 1.2e9,
    points: 1001,
    referenceImpedanceOhm: 50,
    monteCarloRuns: 0,
    monteCarloSeed: 1,
  },
  nodes: [
    {
      id: 's2p',
      position: { x: 10, y: 20 },
      data: {
        label: 'Measured LNA',
        type: 'touchstone2Port',
        parameters: { content: '# GHz S RI R 50\n1 0 0 1 0 0 0 0 0' },
      },
    },
  ],
  edges: [],
  assets: {},
}

describe('versioned RF project files', () => {
  it('round-trips embedded Touchstone text without typed arrays', () => {
    const text = serializeProject(project)
    const restored = parseProjectJson(text)

    expect(restored).toEqual(project)
    expect(text).toContain('# GHz S RI R 50')
    expect(text).not.toContain('Float64Array')
  })

  it('rejects unsupported versions and invalid references', () => {
    expect(() =>
      parseProjectJson(JSON.stringify({ ...project, schemaVersion: 4 })),
    ).toThrow(ProjectFileError)
    expect(() =>
      parseProjectJson(
        JSON.stringify({
          ...project,
          edges: [{ id: 'bad', source: 's2p', target: 'missing' }],
        }),
      ),
    ).toThrow(/missing/u)
  })

  it('migrates schema 1 projects to schema 3', () => {
    const restored = parseProjectJson(
      JSON.stringify({ ...project, schemaVersion: 1 }),
    )
    expect(restored.schemaVersion).toBe(3)
  })

  it('rejects unsafe parameter keys', () => {
    const text = serializeProject(project).replace('"content"', '"__proto__"')
    expect(() => parseProjectJson(text)).toThrow(/unsafe key/u)
  })

  it('round-trips constrained two-variable optimization settings', () => {
    const configured: RFProject = {
      ...project,
      nodes: [
        {
          ...project.nodes[0]!,
          data: {
            ...project.nodes[0]!.data,
            parameters: {
              ...project.nodes[0]!.data.parameters,
              gainDb: 10,
              noiseFigureDb: 2,
            },
          },
        },
      ],
      analysis: {
        ...project.analysis,
        sweepNodeId: 's2p',
        sweepParameter: 'gainDb',
        sweepStart: 8,
        sweepStop: 12,
        sweepPoints: 3,
        sweepSecondNodeId: 's2p',
        sweepSecondParameter: 'noiseFigureDb',
        sweepSecondStart: 1,
        sweepSecondStop: 3,
        sweepSecondPoints: 3,
        sweepMetric: 's21Db',
        sweepObjective: 'maximize',
        sweepConstraintMetric: 'noiseFigureDb',
        sweepConstraintDirection: 'maximum',
        sweepConstraintValue: 2.5,
      },
    }
    expect(parseProjectJson(serializeProject(configured))).toEqual(configured)
  })
})
