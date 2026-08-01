import { parseDeviceTableCsv } from './deviceTable'
import {
  isLoadTerminal,
  isSourceTerminal,
  portsForNode,
  resolveEdgePort,
} from './ports'
import { parseMixerProductCsv } from './mixerProducts'
import { parseTouchstone } from './touchstone'
import type { RFProjectEdge, RFProjectNode } from './types'

export type GraphIssueCode =
  | 'DUPLICATE_NODE_ID'
  | 'DANGLING_EDGE'
  | 'SOURCE_COUNT'
  | 'LOAD_COUNT'
  | 'INVALID_PORT'
  | 'INVALID_PORT_DEGREE'
  | 'CYCLE'
  | 'DISCONNECTED_NODE'
  | 'INVALID_BLOCK_PARAMETER'
  | 'INVALID_TOUCHSTONE'
  | 'INVALID_DEVICE_TABLE'

export interface GraphIssue {
  code: GraphIssueCode
  message: string
  nodeId?: string
  edgeId?: string
}

export interface GraphValidationResult {
  valid: boolean
  orderedNodeIds: string[]
  issues: GraphIssue[]
  branched: boolean
}

export function validateLinearGraph(
  nodes: RFProjectNode[],
  edges: RFProjectEdge[],
): GraphValidationResult {
  const issues: GraphIssue[] = []
  const nodesById = new Map<string, RFProjectNode>()
  for (const node of nodes) {
    if (nodesById.has(node.id)) {
      issues.push({
        code: 'DUPLICATE_NODE_ID',
        nodeId: node.id,
        message: `Node ID "${node.id}" is duplicated.`,
      })
    } else {
      nodesById.set(node.id, node)
    }
  }

  const sources = nodes.filter(isSourceTerminal)
  const loads = nodes.filter(isLoadTerminal)
  if (sources.length !== 1) {
    issues.push({
      code: 'SOURCE_COUNT',
      message: `An RF network requires exactly one source; found ${sources.length}.`,
    })
  }
  if (loads.length !== 1) {
    issues.push({
      code: 'LOAD_COUNT',
      message: `An RF network requires exactly one load; found ${loads.length}.`,
    })
  }

  const outgoing = new Map<string, RFProjectEdge[]>()
  const incoming = new Map<string, RFProjectEdge[]>()
  const usedPorts = new Map<string, RFProjectEdge[]>()
  for (const nodeId of nodesById.keys()) {
    outgoing.set(nodeId, [])
    incoming.set(nodeId, [])
  }

  for (const edge of edges) {
    const source = nodesById.get(edge.source)
    const target = nodesById.get(edge.target)
    if (!source || !target) {
      issues.push({
        code: 'DANGLING_EDGE',
        edgeId: edge.id,
        message: `Connection "${edge.id}" references a missing block.`,
      })
      continue
    }
    const sourcePort = resolveEdgePort(source, 'output', edge.sourceHandle)
    const targetPort = resolveEdgePort(target, 'input', edge.targetHandle)
    if (!sourcePort || !targetPort) {
      issues.push({
        code: 'INVALID_PORT',
        edgeId: edge.id,
        message: `Connection "${edge.id}" requires explicit valid source and target ports.`,
      })
      continue
    }
    addUsedPort(usedPorts, `${source.id}:${sourcePort.id}`, edge)
    addUsedPort(usedPorts, `${target.id}:${targetPort.id}`, edge)
    outgoing.get(source.id)!.push(edge)
    incoming.get(target.id)!.push(edge)
  }

  for (const node of nodesById.values()) {
    for (const port of portsForNode(node)) {
      const count = usedPorts.get(`${node.id}:${port.id}`)?.length ?? 0
      if (count !== 1) {
        issues.push({
          code: 'INVALID_PORT_DEGREE',
          nodeId: node.id,
          message: `Port ${port.label} on "${node.data.label}" has ${count} connection(s); exactly one is required.`,
        })
      }
    }
    validateNodeAssets(node, issues)
  }

  const orderedNodeIds = topologicalOrder(nodesById, outgoing, incoming)
  if (orderedNodeIds.length !== nodesById.size) {
    issues.push({
      code: 'CYCLE',
      message: 'The RF network contains a directed cycle.',
    })
  }

  if (sources.length === 1 && loads.length === 1) {
    const reachableFromSource = reachable(sources[0]!.id, outgoing, 'target')
    const reachingLoad = reachable(loads[0]!.id, incoming, 'source')
    for (const node of nodesById.values()) {
      if (!reachableFromSource.has(node.id) || !reachingLoad.has(node.id)) {
        issues.push({
          code: 'DISCONNECTED_NODE',
          nodeId: node.id,
          message: `Block "${node.data.label}" is not on a source-to-load path.`,
        })
      }
    }
  }

  return {
    valid: issues.length === 0,
    orderedNodeIds,
    issues,
    branched: nodes.some(
      (node) =>
        node.data.type === 'idealSplitter' ||
        node.data.type === 'idealCombiner' ||
        portsForNode(node).length > 2,
    ),
  }
}

function validateNodeAssets(node: RFProjectNode, issues: GraphIssue[]): void {
  validateIdealNodeParameters(node, issues)
  if (
    node.data.type === 'idealMixer' &&
    node.data.parameters.productTableContent !== undefined &&
    node.data.parameters.productTableContent !== null
  ) {
    try {
      if (typeof node.data.parameters.productTableContent !== 'string') {
        throw new Error('invalid content')
      }
      parseMixerProductCsv(node.data.parameters.productTableContent)
    } catch (error) {
      issues.push({
        code: 'INVALID_DEVICE_TABLE',
        nodeId: node.id,
        message: `Mixer "${node.data.label}" product table: ${errorMessage(error)}`,
      })
    }
  }
  if (node.data.type === 'touchstone2Port') {
    const content = node.data.parameters.content
    if (typeof content !== 'string' || content.trim() === '') {
      issues.push({
        code: 'INVALID_TOUCHSTONE',
        nodeId: node.id,
        message: `Touchstone block "${node.data.label}" has no valid file.`,
      })
    } else {
      try {
        parseTouchstone(
          content,
          typeof node.data.parameters.fileName === 'string'
            ? node.data.parameters.fileName
            : undefined,
          Number.isInteger(node.data.parameters.portCount)
            ? (node.data.parameters.portCount as number)
            : 2,
        )
      } catch (error) {
        issues.push({
          code: 'INVALID_TOUCHSTONE',
          nodeId: node.id,
          message: `Touchstone block "${node.data.label}": ${errorMessage(error)}`,
        })
      }
    }
    for (const [contentKey, fileNameKey, side] of [
      ['leftFixtureContent', 'leftFixtureFileName', 'left'],
      ['rightFixtureContent', 'rightFixtureFileName', 'right'],
    ] as const) {
      const fixtureContent = node.data.parameters[contentKey]
      if (fixtureContent === undefined || fixtureContent === null) continue
      try {
        if (typeof fixtureContent !== 'string')
          throw new Error('invalid content')
        parseTouchstone(
          fixtureContent,
          typeof node.data.parameters[fileNameKey] === 'string'
            ? (node.data.parameters[fileNameKey] as string)
            : undefined,
          2,
        )
      } catch (error) {
        issues.push({
          code: 'INVALID_TOUCHSTONE',
          nodeId: node.id,
          message: `${node.data.label} ${side} fixture: ${errorMessage(error)}`,
        })
      }
    }
  }
  if (node.data.type !== 'idealAmplifier') return
  const sParameterContent = node.data.parameters.sParameterContent
  if (sParameterContent !== undefined && sParameterContent !== null) {
    try {
      if (typeof sParameterContent !== 'string')
        throw new Error('invalid content')
      parseTouchstone(
        sParameterContent,
        typeof node.data.parameters.sParameterFileName === 'string'
          ? node.data.parameters.sParameterFileName
          : undefined,
        2,
      )
    } catch (error) {
      issues.push({
        code: 'INVALID_TOUCHSTONE',
        nodeId: node.id,
        message: `Amplifier "${node.data.label}" S-parameters: ${errorMessage(error)}`,
      })
    }
  }
  const deviceTableContent = node.data.parameters.deviceTableContent
  if (deviceTableContent !== undefined && deviceTableContent !== null) {
    try {
      if (typeof deviceTableContent !== 'string')
        throw new Error('invalid content')
      parseDeviceTableCsv(deviceTableContent)
    } catch (error) {
      issues.push({
        code: 'INVALID_DEVICE_TABLE',
        nodeId: node.id,
        message: `Amplifier "${node.data.label}" device table: ${errorMessage(error)}`,
      })
    }
  }
}

function validateIdealNodeParameters(
  node: RFProjectNode,
  issues: GraphIssue[],
): void {
  if (
    node.data.type !== 'idealFilter' &&
    node.data.type !== 'idealPhaseShifter' &&
    node.data.type !== 'idealIsolator' &&
    node.data.type !== 'idealRFSwitch' &&
    node.data.type !== 'idealDirectionalCoupler' &&
    node.data.type !== 'idealDiplexer' &&
    node.data.type !== 'transmissionLine' &&
    node.data.type !== 'matchingNetwork' &&
    node.data.type !== 'idealBalun' &&
    node.data.type !== 'vcoSource' &&
    node.data.type !== 'rxAntenna' &&
    node.data.type !== 'txAntenna'
  ) {
    return
  }
  try {
    const number = (key: string) => {
      const value = node.data.parameters[key]
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`${key} must be finite`)
      }
      return value
    }
    const nonnegative = (key: string) => {
      const value = number(key)
      if (value < 0) throw new Error(`${key} must be non-negative`)
      return value
    }
    const positive = (key: string) => {
      const value = number(key)
      if (value <= 0) throw new Error(`${key} must be positive`)
      return value
    }
    const optionalNumber = (key: string, fallback: number) =>
      node.data.parameters[key] === undefined ? fallback : number(key)
    const antennaParameters = () => {
      const efficiency = optionalNumber('efficiencyPercent', 70)
      if (efficiency <= 0 || efficiency > 100) {
        throw new Error('efficiencyPercent must be above 0 and at most 100')
      }
      if (optionalNumber('patternExponent', 2) < 0) {
        throw new Error('patternExponent must be non-negative')
      }
      if (optionalNumber('frontToBackDb', 20) < 0) {
        throw new Error('frontToBackDb must be non-negative')
      }
    }
    if (!isSourceTerminal(node)) positive('referenceImpedanceOhm')
    if (node.data.type === 'idealFilter') {
      const type = node.data.parameters.filterType
      if (
        !['lowpass', 'highpass', 'bandpass', 'bandstop'].includes(String(type))
      ) {
        throw new Error('filterType is invalid')
      }
      positive(
        type === 'lowpass' || type === 'highpass'
          ? 'cutoffFrequencyHz'
          : 'centerFrequencyHz',
      )
      if (type === 'bandpass' || type === 'bandstop') positive('bandwidthHz')
      const order = number('order')
      if (!Number.isInteger(order) || order < 1 || order > 10) {
        throw new Error('order must be an integer from 1 to 10')
      }
      nonnegative('insertionLossDb')
    } else if (node.data.type === 'idealPhaseShifter') {
      number('phaseDeg')
      nonnegative('insertionLossDb')
    } else if (node.data.type === 'idealIsolator') {
      const forwardLossDb = nonnegative('forwardLossDb')
      const reverseIsolationDb = nonnegative('reverseIsolationDb')
      number('phaseDeg')
      if (reverseIsolationDb < forwardLossDb) {
        throw new Error('reverseIsolationDb must not be below forwardLossDb')
      }
    } else if (node.data.type === 'idealRFSwitch') {
      if (typeof node.data.parameters.enabled !== 'boolean') {
        throw new Error('enabled must be boolean')
      }
      const insertionLossDb = nonnegative('insertionLossDb')
      const isolationDb = nonnegative('isolationDb')
      number('phaseDeg')
      if (isolationDb < insertionLossDb) {
        throw new Error('isolationDb must not be below insertionLossDb')
      }
    } else if (node.data.type === 'idealDirectionalCoupler') {
      positive('couplingDb')
      nonnegative('excessLossDb')
    } else if (node.data.type === 'idealDiplexer') {
      positive('crossoverFrequencyHz')
      const order = number('order')
      if (!Number.isInteger(order) || order < 1 || order > 10) {
        throw new Error('order must be an integer from 1 to 10')
      }
      nonnegative('insertionLossDb')
    } else if (node.data.type === 'transmissionLine') {
      nonnegative('delayS')
      nonnegative('insertionLossDb')
    } else if (node.data.type === 'matchingNetwork') {
      if (!['l', 'pi', 't'].includes(String(node.data.parameters.topology))) {
        throw new Error('topology is invalid')
      }
      if (
        !['lowpass', 'highpass'].includes(String(node.data.parameters.response))
      ) {
        throw new Error('response is invalid')
      }
      positive('inductanceH')
      positive('capacitanceF')
      positive('componentQ')
    } else if (node.data.type === 'idealBalun') {
      nonnegative('excessLossDb')
      number('amplitudeImbalanceDb')
      number('phaseErrorDeg')
      nonnegative('isolationDb')
    } else if (node.data.type === 'vcoSource') {
      const frequency =
        positive('freeRunningFrequencyHz') +
        number('tuningSensitivityHzPerV') * number('controlVoltageV')
      if (frequency <= 0) throw new Error('tuned frequency must be positive')
      number('powerDbm')
      positive('sourceImpedanceOhm')
      optionalNumber('phaseNoiseAt1MHzDbcHz', -120)
      const slope = optionalNumber('phaseNoiseSlopeDbPerDecade', -20)
      if (slope > 0)
        throw new Error('phaseNoiseSlopeDbPerDecade must be at most 0')
      optionalNumber('phaseNoiseFloorDbcHz', -160)
      const integrationStart = optionalNumber(
        'phaseNoiseIntegrationStartHz',
        100,
      )
      const integrationStop = optionalNumber(
        'phaseNoiseIntegrationStopHz',
        10e6,
      )
      if (integrationStart <= 0 || integrationStop <= integrationStart) {
        throw new Error(
          'phase-noise integration range must be positive and increasing',
        )
      }
      if (
        node.data.parameters.pllEnabled !== undefined &&
        typeof node.data.parameters.pllEnabled !== 'boolean'
      ) {
        throw new Error('pllEnabled must be boolean')
      }
      if (optionalNumber('pllLoopBandwidthHz', 100e3) <= 0) {
        throw new Error('pllLoopBandwidthHz must be positive')
      }
      optionalNumber('pllInBandPhaseNoiseDbcHz', -140)
    } else if (node.data.type === 'rxAntenna') {
      positive('centerFrequencyHz')
      number('powerDbm')
      positive('sourceImpedanceOhm')
      antennaParameters()
    } else {
      positive('loadImpedanceOhm')
      antennaParameters()
    }
  } catch (error) {
    issues.push({
      code: 'INVALID_BLOCK_PARAMETER',
      nodeId: node.id,
      message: `Block "${node.data.label}": ${errorMessage(error)}.`,
    })
  }
}

function addUsedPort(
  usedPorts: Map<string, RFProjectEdge[]>,
  key: string,
  edge: RFProjectEdge,
): void {
  const existing = usedPorts.get(key)
  if (existing) existing.push(edge)
  else usedPorts.set(key, [edge])
}

function topologicalOrder(
  nodesById: Map<string, RFProjectNode>,
  outgoing: Map<string, RFProjectEdge[]>,
  incoming: Map<string, RFProjectEdge[]>,
): string[] {
  const remainingIncoming = new Map(
    Array.from(nodesById.keys(), (nodeId) => [
      nodeId,
      incoming.get(nodeId)?.length ?? 0,
    ]),
  )
  const queue = Array.from(nodesById.keys()).filter(
    (nodeId) => remainingIncoming.get(nodeId) === 0,
  )
  const ordered: string[] = []
  while (queue.length > 0) {
    const nodeId = queue.shift()!
    ordered.push(nodeId)
    for (const edge of outgoing.get(nodeId) ?? []) {
      const remaining = (remainingIncoming.get(edge.target) ?? 0) - 1
      remainingIncoming.set(edge.target, remaining)
      if (remaining === 0) queue.push(edge.target)
    }
  }
  return ordered
}

function reachable(
  startId: string,
  edgesByNode: Map<string, RFProjectEdge[]>,
  nextKey: 'source' | 'target',
): Set<string> {
  const visited = new Set<string>()
  const pending = [startId]
  while (pending.length > 0) {
    const nodeId = pending.pop()!
    if (visited.has(nodeId)) continue
    visited.add(nodeId)
    for (const edge of edgesByNode.get(nodeId) ?? [])
      pending.push(edge[nextKey])
  }
  return visited
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'invalid file'
}
