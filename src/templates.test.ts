import { expect, it } from 'vitest'
import { simulateLinearChain } from './engine/simulation'
import { validateProject } from './persistence/projectFile'
import { rfTemplates } from './templates'

it.each(rfTemplates)(
  '$label template is valid and simulates',
  ({ project }) => {
    const validated = validateProject(project)
    const result = simulateLinearChain({
      analysis: validated.analysis,
      nodes: validated.nodes,
      edges: validated.edges,
    })

    expect(result.total.frequencyHz.length).toBe(project.analysis.points)
    expect(result.budget.deliveredLoadPowerDbm).not.toBeNull()
    expect(new Set(project.nodes.map((node) => node.id)).size).toBe(
      project.nodes.length,
    )
    expect(new Set(project.edges.map((edge) => edge.id)).size).toBe(
      project.edges.length,
    )
    expect(
      project.edges.map(({ source, sourceHandle, target, targetHandle }) => ({
        source,
        sourceHandle,
        target,
        targetHandle,
      })),
    ).toEqual(
      project.nodes.slice(1).map((node, index) => ({
        source: project.nodes[index]!.id,
        sourceHandle: 'output',
        target: node.id,
        targetHandle: 'input',
      })),
    )
    expect(project.nodes.every((node) => node.data.label.length <= 20)).toBe(
      true,
    )
  },
)
