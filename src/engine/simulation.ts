import { cascadeTwoPorts } from './cascade'
import { magnitudeDb } from './complex'
import { deriveSimulationCurves } from './derivedMetrics'
import {
  createIdealAmplifier,
  createIdealAttenuator,
  createThroughNetwork,
} from './idealNetworks'
import { buildCommonFrequencyGrid, interpolateNetwork } from './interpolation'
import { parseTouchstoneS2P } from './touchstone'
import type {
  RFProjectNode,
  SimulationInput,
  SimulationOutput,
  SimulationStageSummary,
  TwoPortNetwork,
} from './types'
import { validateLinearGraph, type GraphIssue } from './validation'

export class SimulationError extends Error {
  readonly graphIssues: GraphIssue[]

  constructor(message: string, graphIssues: GraphIssue[] = []) {
    super(message)
    this.name = 'SimulationError'
    this.graphIssues = graphIssues
  }
}

export function simulateLinearChain(input: SimulationInput): SimulationOutput {
  const validation = validateLinearGraph(input.nodes, input.edges)
  if (!validation.valid) {
    throw new SimulationError(
      validation.issues.map((issue) => issue.message).join(' '),
      validation.issues,
    )
  }

  const nodesById = new Map(input.nodes.map((node) => [node.id, node]))
  const orderedNodes = validation.orderedNodeIds.map((nodeId) => {
    const node = nodesById.get(nodeId)
    if (!node)
      throw new SimulationError(`Validated node "${nodeId}" is missing.`)
    return node
  })

  validateBlockReferenceImpedances(
    orderedNodes,
    input.analysis.referenceImpedanceOhm,
  )
  const parsedNetworks = new Map<string, TwoPortNetwork>()
  for (const node of orderedNodes) {
    if (node.data.type !== 'touchstone2Port') continue
    const content = node.data.parameters.content
    if (typeof content !== 'string') {
      throw new SimulationError(
        `Touchstone block "${node.data.label}" has no file.`,
      )
    }
    const sourceName =
      typeof node.data.parameters.fileName === 'string'
        ? node.data.parameters.fileName
        : node.data.label
    const network = parseTouchstoneS2P(content, sourceName)
    assertReferenceImpedance(
      network.referenceImpedanceOhm,
      input.analysis.referenceImpedanceOhm,
      node.data.label,
    )
    parsedNetworks.set(node.id, network)
  }

  const commonGrid = buildCommonFrequencyGrid(
    [...parsedNetworks.values()],
    input.analysis,
  )
  const warnings = [...commonGrid.warnings]
  let cumulative = createThroughNetwork(
    commonGrid.frequencyHz,
    input.analysis.referenceImpedanceOhm,
    'Chain input',
  )
  const stageSummaries: SimulationStageSummary[] = []

  for (const node of orderedNodes) {
    if (node.data.type === 'source' || node.data.type === 'load') continue

    if (node.data.type !== 'probe') {
      const stageNetwork = networkForNode(
        node,
        commonGrid.frequencyHz,
        input.analysis.referenceImpedanceOhm,
        parsedNetworks,
      )
      const cascade = cascadeTwoPorts(cumulative, stageNetwork)
      cumulative = cascade.network
      warnings.push(...cascade.warnings)
    }

    stageSummaries.push(summarizeStage(node, cumulative))
  }

  const derived = deriveSimulationCurves(cumulative)
  warnings.push(...derived.warnings)
  return {
    total: cumulative,
    curves: derived.curves,
    stageSummaries,
    warnings,
  }
}

function networkForNode(
  node: RFProjectNode,
  frequencyHz: Float64Array,
  referenceImpedanceOhm: number,
  parsedNetworks: Map<string, TwoPortNetwork>,
): TwoPortNetwork {
  switch (node.data.type) {
    case 'touchstone2Port': {
      const network = parsedNetworks.get(node.id)
      if (!network)
        throw new SimulationError(
          `Missing parsed network for "${node.data.label}".`,
        )
      return interpolateNetwork(network, frequencyHz)
    }
    case 'idealAmplifier':
      return createIdealAmplifier(
        frequencyHz,
        finiteParameter(node, 'gainDb'),
        finiteParameter(node, 'phaseDeg'),
        referenceImpedanceOhm,
        node.data.label,
      )
    case 'idealAttenuator':
      return createIdealAttenuator(
        frequencyHz,
        finiteParameter(node, 'attenuationDb'),
        finiteParameter(node, 'phaseDeg'),
        referenceImpedanceOhm,
        node.data.label,
      )
    case 'probe':
    case 'source':
    case 'load':
      throw new SimulationError(
        `Block "${node.data.label}" is not a two-port stage.`,
      )
  }
}

function summarizeStage(
  node: RFProjectNode,
  cumulative: TwoPortNetwork,
): SimulationStageSummary {
  const centerIndex = Math.floor(cumulative.frequencyHz.length / 2)
  return {
    nodeId: node.id,
    label: node.data.label,
    s21DbAtCenter: magnitudeDb({
      re: cumulative.s21.re[centerIndex]!,
      im: cumulative.s21.im[centerIndex]!,
    }),
  }
}

function validateBlockReferenceImpedances(
  nodes: RFProjectNode[],
  expectedOhm: number,
): void {
  for (const node of nodes) {
    if (
      node.data.type !== 'idealAmplifier' &&
      node.data.type !== 'idealAttenuator' &&
      node.data.type !== 'load'
    ) {
      continue
    }
    assertReferenceImpedance(
      finiteParameter(node, 'referenceImpedanceOhm'),
      expectedOhm,
      node.data.label,
    )
  }
}

function assertReferenceImpedance(
  actualOhm: number,
  expectedOhm: number,
  label: string,
): void {
  if (
    !Number.isFinite(expectedOhm) ||
    expectedOhm <= 0 ||
    Math.abs(actualOhm - expectedOhm) >
      Math.max(1, actualOhm, expectedOhm) * 1e-12
  ) {
    throw new SimulationError(
      `Reference impedance mismatch at "${label}": ${actualOhm} Ω versus analysis ${expectedOhm} Ω.`,
    )
  }
}

function finiteParameter(node: RFProjectNode, key: string): number {
  const value = node.data.parameters[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new SimulationError(
      `Parameter "${key}" is invalid at "${node.data.label}".`,
    )
  }
  return value
}
