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
  },
)
