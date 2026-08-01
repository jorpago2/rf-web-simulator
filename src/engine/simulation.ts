import { cascadeTwoPorts } from './cascade'
import { calculateRFBudget, type BudgetStageInput } from './budget'
import { magnitudeDb } from './complex'
import { deriveSimulationCurves, magnitudeDbArray } from './derivedMetrics'
import { calculateFrequencyPlan } from './frequencyPlan'
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
  SimulationProbeResult,
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

  const localFrequencyOffsetsHz = new Map<string, number>()
  let localFrequencyOffsetHz = 0
  for (const node of orderedNodes) {
    localFrequencyOffsetsHz.set(node.id, localFrequencyOffsetHz)
    if (node.data.type === 'idealMixer') {
      const loFrequencyHz = finiteParameter(node, 'loFrequencyHz')
      localFrequencyOffsetHz +=
        mixerMode(node) === 'upconvert' ? loFrequencyHz : -loFrequencyHz
    }
  }

  const commonGrid = buildCommonFrequencyGrid(
    [...parsedNetworks].map(([nodeId, network]) => ({
      network,
      inputFrequencyOffsetHz: localFrequencyOffsetsHz.get(nodeId) ?? 0,
    })),
    input.analysis,
  )
  const warnings = [...commonGrid.warnings]
  const mixerNodes = orderedNodes.filter(
    (node) => node.data.type === 'idealMixer',
  )
  const frequencyPlan = calculateFrequencyPlan(
    commonGrid.frequencyHz,
    mixerNodes.map((node) => ({
      nodeId: node.id,
      label: node.data.label,
      mode: mixerMode(node),
      loFrequencyHz: finiteParameter(node, 'loFrequencyHz'),
    })),
  )
  if (mixerNodes.length > 0) {
    warnings.push({
      code: 'FREQUENCY_CONVERSION_MODEL',
      message:
        'Mixer results are an ideal conversion-gain envelope versus input frequency. Post-mixer Touchstone stages are evaluated at their translated local frequency; conversion phase, images, LO leakage, and spurs are not modeled.',
    })
  }
  let cumulative = createThroughNetwork(
    commonGrid.frequencyHz,
    input.analysis.referenceImpedanceOhm,
    'Chain input',
  )
  const stageSummaries: SimulationStageSummary[] = []
  const probeResults: SimulationProbeResult[] = []
  const budgetStages: BudgetStageInput[] = []

  for (const node of orderedNodes) {
    if (node.data.type === 'source' || node.data.type === 'load') continue

    if (node.data.type === 'probe') {
      probeResults.push({
        nodeId: node.id,
        label: node.data.label,
        s21Db: magnitudeDbArray(cumulative.s21),
      })
    } else {
      const stageNetwork = networkForNode(
        node,
        commonGrid.frequencyHz,
        localFrequencyOffsetsHz.get(node.id) ?? 0,
        input.analysis.referenceImpedanceOhm,
        parsedNetworks,
      )
      const cascade = cascadeTwoPorts(cumulative, stageNetwork)
      cumulative = cascade.network
      warnings.push(...cascade.warnings)
      budgetStages.push(budgetStage(node, stageNetwork))
    }

    stageSummaries.push(summarizeStage(node, cumulative))
  }

  const derived = deriveSimulationCurves(cumulative)
  if (mixerNodes.length > 0) {
    derived.curves.s21PhaseDeg.fill(Number.NaN)
    derived.curves.s21GroupDelayS.fill(Number.NaN)
  }
  warnings.push(...derived.warnings)
  const centerIndex = Math.floor(commonGrid.frequencyHz.length / 2)
  const source = orderedNodes[0]!
  return {
    total: cumulative,
    curves: derived.curves,
    stageSummaries,
    probeResults,
    budget: calculateRFBudget(
      commonGrid.frequencyHz[centerIndex]!,
      optionalFiniteParameter(source, 'powerDbm'),
      budgetStages,
    ),
    frequencyPlan,
    warnings,
  }
}

function budgetStage(
  node: RFProjectNode,
  network: TwoPortNetwork,
): BudgetStageInput {
  const centerIndex = Math.floor(network.frequencyHz.length / 2)
  const gainDb = magnitudeDb({
    re: network.s21.re[centerIndex]!,
    im: network.s21.im[centerIndex]!,
  })
  const stageGainDb = Number.isFinite(gainDb) ? gainDb : null

  if (node.data.type === 'idealAttenuator') {
    return {
      nodeId: node.id,
      label: node.data.label,
      type: node.data.type,
      gainDb: stageGainDb,
      noiseFigureDb: finiteParameter(node, 'attenuationDb'),
      outputP1Dbm: Number.POSITIVE_INFINITY,
      outputIp3Dbm: Number.POSITIVE_INFINITY,
    }
  }
  return {
    nodeId: node.id,
    label: node.data.label,
    type: node.data.type,
    gainDb: stageGainDb,
    noiseFigureDb: optionalFiniteParameter(node, 'noiseFigureDb', 0),
    outputP1Dbm: optionalFiniteParameter(node, 'outputP1Dbm'),
    outputIp3Dbm: optionalFiniteParameter(node, 'outputIp3Dbm'),
  }
}

function networkForNode(
  node: RFProjectNode,
  frequencyHz: Float64Array,
  localFrequencyOffsetHz: number,
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
      const localFrequencyHz = Float64Array.from(
        frequencyHz,
        (value) => value + localFrequencyOffsetHz,
      )
      localFrequencyHz[0] = Math.max(
        localFrequencyHz[0]!,
        network.frequencyHz[0]!,
      )
      localFrequencyHz[localFrequencyHz.length - 1] = Math.min(
        localFrequencyHz.at(-1)!,
        network.frequencyHz.at(-1)!,
      )
      return {
        ...interpolateNetwork(network, localFrequencyHz),
        frequencyHz,
      }
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
    case 'idealMixer':
      return createIdealAttenuator(
        frequencyHz,
        finiteParameter(node, 'conversionLossDb'),
        0,
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
      node.data.type !== 'idealMixer' &&
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

function mixerMode(node: RFProjectNode): 'downconvert' | 'upconvert' {
  const value = node.data.parameters.mixerMode
  if (value !== 'downconvert' && value !== 'upconvert') {
    throw new SimulationError(`Mixer mode is invalid at "${node.data.label}".`)
  }
  return value
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

function optionalFiniteParameter(
  node: RFProjectNode,
  key: string,
  minimum?: number,
): number | null {
  const value = node.data.parameters[key]
  if (value === undefined || value === null) return null
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    (minimum !== undefined && value < minimum)
  ) {
    throw new SimulationError(
      `Optional parameter "${key}" is invalid at "${node.data.label}".`,
    )
  }
  return value
}
