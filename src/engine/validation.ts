import { parseTouchstoneS2P } from './touchstone'
import { parseDeviceTableCsv } from './deviceTable'
import type { RFProjectEdge, RFProjectNode } from './types'

export type GraphIssueCode =
  | 'DUPLICATE_NODE_ID'
  | 'DANGLING_EDGE'
  | 'SOURCE_COUNT'
  | 'LOAD_COUNT'
  | 'INVALID_PORT_DEGREE'
  | 'CYCLE'
  | 'DISCONNECTED_NODE'
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

  const incoming = new Map<string, RFProjectEdge[]>()
  const outgoing = new Map<string, RFProjectEdge[]>()
  for (const nodeId of nodesById.keys()) {
    incoming.set(nodeId, [])
    outgoing.set(nodeId, [])
  }

  for (const edge of edges) {
    if (!nodesById.has(edge.source) || !nodesById.has(edge.target)) {
      issues.push({
        code: 'DANGLING_EDGE',
        edgeId: edge.id,
        message: `Connection "${edge.id}" references a missing block.`,
      })
      continue
    }
    outgoing.get(edge.source)?.push(edge)
    incoming.get(edge.target)?.push(edge)
  }

  const sources = nodes.filter((node) => node.data.type === 'source')
  const loads = nodes.filter((node) => node.data.type === 'load')
  if (sources.length !== 1) {
    issues.push({
      code: 'SOURCE_COUNT',
      message: `A linear chain requires exactly one source; found ${sources.length}.`,
    })
  }
  if (loads.length !== 1) {
    issues.push({
      code: 'LOAD_COUNT',
      message: `A linear chain requires exactly one load; found ${loads.length}.`,
    })
  }

  for (const node of nodesById.values()) {
    const inputCount = incoming.get(node.id)?.length ?? 0
    const outputCount = outgoing.get(node.id)?.length ?? 0
    const validDegree =
      node.data.type === 'source'
        ? inputCount === 0 && outputCount === 1
        : node.data.type === 'load'
          ? inputCount === 1 && outputCount === 0
          : inputCount === 1 && outputCount === 1

    if (!validDegree) {
      issues.push({
        code: 'INVALID_PORT_DEGREE',
        nodeId: node.id,
        message: `Block "${node.data.label}" has ${inputCount} input(s) and ${outputCount} output(s); the MVP accepts one linear path only.`,
      })
    }

    if (node.data.type === 'touchstone2Port') {
      const content = node.data.parameters.content
      if (typeof content !== 'string' || content.trim() === '') {
        issues.push({
          code: 'INVALID_TOUCHSTONE',
          nodeId: node.id,
          message: `Touchstone block "${node.data.label}" has no valid .s2p file.`,
        })
      } else {
        try {
          parseTouchstoneS2P(content)
        } catch (error) {
          issues.push({
            code: 'INVALID_TOUCHSTONE',
            nodeId: node.id,
            message: `Touchstone block "${node.data.label}": ${errorMessage(error)}`,
          })
        }
      }
    }
    if (node.data.type === 'idealAmplifier') {
      const sParameterContent = node.data.parameters.sParameterContent
      if (sParameterContent !== undefined && sParameterContent !== null) {
        try {
          if (typeof sParameterContent !== 'string')
            throw new Error('invalid content')
          parseTouchstoneS2P(sParameterContent)
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
  }

  const orderedNodeIds: string[] = []
  const visited = new Set<string>()
  let current = sources.length === 1 ? sources[0] : undefined
  while (current) {
    if (visited.has(current.id)) {
      issues.push({
        code: 'CYCLE',
        nodeId: current.id,
        message: `A cycle reaches block "${current.data.label}".`,
      })
      break
    }
    visited.add(current.id)
    orderedNodeIds.push(current.id)
    const nextEdge = outgoing.get(current.id)?.[0]
    current = nextEdge ? nodesById.get(nextEdge.target) : undefined
  }

  for (const node of nodesById.values()) {
    if (!visited.has(node.id)) {
      issues.push({
        code: 'DISCONNECTED_NODE',
        nodeId: node.id,
        message: `Block "${node.data.label}" is not on the source-to-load path.`,
      })
    }
  }

  return { valid: issues.length === 0, orderedNodeIds, issues }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'invalid file'
}
