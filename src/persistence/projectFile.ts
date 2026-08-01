import type {
  RFAnalysisSettings,
  RFEmbeddedAsset,
  RFNodeData,
  RFNodeType,
  RFProject,
  RFProjectEdge,
  RFProjectNode,
} from '../engine/types'

export const MAX_PROJECT_FILE_CHARACTERS = 20 * 1024 * 1024
const MAX_NODES = 256
const MAX_EDGES = 1024
const RF_NODE_TYPES = new Set<RFNodeType>([
  'source',
  'touchstone2Port',
  'idealAmplifier',
  'idealAttenuator',
  'idealFilter',
  'idealPhaseShifter',
  'idealIsolator',
  'idealRFSwitch',
  'idealDirectionalCoupler',
  'idealDiplexer',
  'transmissionLine',
  'matchingNetwork',
  'idealBalun',
  'vcoSource',
  'rxAntenna',
  'txAntenna',
  'idealMixer',
  'idealSplitter',
  'idealCombiner',
  'load',
  'probe',
])
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export class ProjectFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectFileError'
  }
}

export function serializeProject(project: RFProject): string {
  return JSON.stringify(validateProject(project), null, 2)
}

export function parseProjectJson(text: string): RFProject {
  if (text.length > MAX_PROJECT_FILE_CHARACTERS) {
    throw new ProjectFileError('Project file exceeds the 20 MiB MVP limit.')
  }
  try {
    return validateProject(JSON.parse(text) as unknown)
  } catch (error) {
    if (error instanceof ProjectFileError) throw error
    throw new ProjectFileError(
      `Invalid project JSON: ${error instanceof Error ? error.message : 'parse failure'}.`,
    )
  }
}

export function validateProject(value: unknown): RFProject {
  const project = record(value, 'Project')
  if (
    project.schemaVersion !== 1 &&
    project.schemaVersion !== 2 &&
    project.schemaVersion !== 3
  ) {
    throw new ProjectFileError(
      `Unsupported schemaVersion "${String(project.schemaVersion)}"; expected 1, 2, or 3.`,
    )
  }

  const name = boundedString(project.name, 'Project name', 200)
  const nodesValue = array(project.nodes, 'nodes', MAX_NODES)
  const edgesValue = array(project.edges, 'edges', MAX_EDGES)
  const nodes = nodesValue.map((node, index) => validateNode(node, index))
  const edges = edgesValue.map((edge, index) => validateEdge(edge, index))
  ensureUnique(
    nodes.map((node) => node.id),
    'node ID',
  )
  ensureUnique(
    edges.map((edge) => edge.id),
    'edge ID',
  )
  const nodeIds = new Set(nodes.map((node) => node.id))
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      throw new ProjectFileError(
        `Edge "${edge.id}" references a missing source or target node.`,
      )
    }
  }
  const analysis = validateAnalysis(project.analysis)
  if (analysis.sweepNodeId) {
    const sweepNode = nodes.find((node) => node.id === analysis.sweepNodeId)
    if (!sweepNode) {
      throw new ProjectFileError('Parametric sweep references a missing node.')
    }
    if (
      !analysis.sweepParameter ||
      typeof sweepNode.data.parameters[analysis.sweepParameter] !== 'number'
    ) {
      throw new ProjectFileError(
        'Parametric sweep references a non-numeric parameter.',
      )
    }
  }
  if (analysis.sweepSecondNodeId) {
    const sweepNode = nodes.find(
      (node) => node.id === analysis.sweepSecondNodeId,
    )
    if (!sweepNode) {
      throw new ProjectFileError(
        'Second sweep variable references a missing node.',
      )
    }
    if (
      !analysis.sweepSecondParameter ||
      typeof sweepNode.data.parameters[analysis.sweepSecondParameter] !==
        'number'
    ) {
      throw new ProjectFileError(
        'Second sweep variable references a non-numeric parameter.',
      )
    }
  }

  return {
    schemaVersion: 3,
    name,
    nodes,
    edges,
    analysis,
    assets: validateAssets(project.assets),
  }
}

function validateNode(value: unknown, index: number): RFProjectNode {
  const node = record(value, `nodes[${index}]`)
  const data = record(node.data, `nodes[${index}].data`)
  const type = boundedString(data.type, `nodes[${index}].data.type`, 50)
  if (!RF_NODE_TYPES.has(type as RFNodeType)) {
    throw new ProjectFileError(`Unsupported RF node type "${type}".`)
  }
  const position = record(node.position, `nodes[${index}].position`)
  const nodeData: RFNodeData = {
    label: boundedString(data.label, `nodes[${index}].data.label`, 200),
    type: type as RFNodeType,
    parameters: validateJsonRecord(
      data.parameters,
      `nodes[${index}].data.parameters`,
      0,
    ),
  }
  return {
    id: boundedString(node.id, `nodes[${index}].id`, 200),
    position: {
      x: finiteNumber(position.x, `nodes[${index}].position.x`),
      y: finiteNumber(position.y, `nodes[${index}].position.y`),
    },
    data: nodeData,
  }
}

function validateEdge(value: unknown, index: number): RFProjectEdge {
  const edge = record(value, `edges[${index}]`)
  return {
    id: boundedString(edge.id, `edges[${index}].id`, 200),
    source: boundedString(edge.source, `edges[${index}].source`, 200),
    target: boundedString(edge.target, `edges[${index}].target`, 200),
    ...(edge.sourceHandle === undefined
      ? {}
      : {
          sourceHandle: boundedString(
            edge.sourceHandle,
            `edges[${index}].sourceHandle`,
            100,
          ),
        }),
    ...(edge.targetHandle === undefined
      ? {}
      : {
          targetHandle: boundedString(
            edge.targetHandle,
            `edges[${index}].targetHandle`,
            100,
          ),
        }),
  }
}

function validateAnalysis(value: unknown): RFAnalysisSettings {
  const analysis = record(value, 'analysis')
  const startHz = finiteNumber(analysis.startHz, 'analysis.startHz')
  const stopHz = finiteNumber(analysis.stopHz, 'analysis.stopHz')
  const points = finiteNumber(analysis.points, 'analysis.points')
  const referenceImpedanceOhm = finiteNumber(
    analysis.referenceImpedanceOhm,
    'analysis.referenceImpedanceOhm',
  )
  const monteCarloRuns =
    analysis.monteCarloRuns === undefined
      ? 0
      : finiteNumber(analysis.monteCarloRuns, 'analysis.monteCarloRuns')
  const monteCarloSeed =
    analysis.monteCarloSeed === undefined
      ? 1
      : finiteNumber(analysis.monteCarloSeed, 'analysis.monteCarloSeed')
  if (startHz < 0 || stopHz <= startHz) {
    throw new ProjectFileError('Analysis requires 0 ≤ startHz < stopHz.')
  }
  if (!Number.isInteger(points) || points < 2 || points > 10_001) {
    throw new ProjectFileError(
      'Analysis points must be an integer from 2 to 10,001.',
    )
  }
  if (referenceImpedanceOhm <= 0) {
    throw new ProjectFileError('Reference impedance must be positive.')
  }
  if (
    !Number.isInteger(monteCarloRuns) ||
    monteCarloRuns < 0 ||
    monteCarloRuns > 500
  ) {
    throw new ProjectFileError(
      'Monte Carlo runs must be an integer from 0 to 500.',
    )
  }
  if (
    !Number.isInteger(monteCarloSeed) ||
    monteCarloSeed < 0 ||
    monteCarloSeed > 0xffffffff
  ) {
    throw new ProjectFileError(
      'Monte Carlo seed must be a 32-bit unsigned integer.',
    )
  }
  const sweepActive =
    typeof analysis.sweepNodeId === 'string' &&
    typeof analysis.sweepParameter === 'string'
  let sweep: Partial<RFAnalysisSettings> = {}
  if (sweepActive) {
    safeKey(analysis.sweepParameter as string, 'sweep parameter')
    const sweepStart = finiteNumber(analysis.sweepStart, 'analysis.sweepStart')
    const sweepStop = finiteNumber(analysis.sweepStop, 'analysis.sweepStop')
    const sweepPoints =
      analysis.sweepPoints === undefined
        ? 11
        : finiteNumber(analysis.sweepPoints, 'analysis.sweepPoints')
    const sweepMetric = analysis.sweepMetric ?? 's21Db'
    const sweepObjective = analysis.sweepObjective ?? 'maximize'
    if (
      sweepStart >= sweepStop ||
      !Number.isInteger(sweepPoints) ||
      sweepPoints < 2 ||
      sweepPoints > 101
    ) {
      throw new ProjectFileError(
        'Parametric sweep requires start < stop and 2–101 points.',
      )
    }
    if (
      !['s21Db', 'noiseFigureDb', 'inputP1Dbm', 'loadPowerDbm'].includes(
        sweepMetric as string,
      )
    ) {
      throw new ProjectFileError('Parametric sweep metric is invalid.')
    }
    if (sweepObjective !== 'minimize' && sweepObjective !== 'maximize') {
      throw new ProjectFileError('Parametric sweep objective is invalid.')
    }
    sweep = {
      sweepNodeId: analysis.sweepNodeId as string,
      sweepParameter: analysis.sweepParameter as string,
      sweepStart,
      sweepStop,
      sweepPoints,
      sweepMetric: sweepMetric as RFAnalysisSettings['sweepMetric'],
      sweepObjective,
    }
    if (
      typeof analysis.sweepSecondNodeId === 'string' &&
      typeof analysis.sweepSecondParameter === 'string'
    ) {
      safeKey(analysis.sweepSecondParameter, 'second sweep parameter')
      const sweepSecondStart = finiteNumber(
        analysis.sweepSecondStart,
        'analysis.sweepSecondStart',
      )
      const sweepSecondStop = finiteNumber(
        analysis.sweepSecondStop,
        'analysis.sweepSecondStop',
      )
      const sweepSecondPoints =
        analysis.sweepSecondPoints === undefined
          ? 5
          : finiteNumber(
              analysis.sweepSecondPoints,
              'analysis.sweepSecondPoints',
            )
      if (
        sweepSecondStart >= sweepSecondStop ||
        !Number.isInteger(sweepSecondPoints) ||
        sweepSecondPoints < 2 ||
        sweepSecondPoints > 51 ||
        sweepPoints * sweepSecondPoints > 1000
      ) {
        throw new ProjectFileError(
          'Second sweep variable requires start < stop, 2–51 points, and at most 1,000 combined evaluations.',
        )
      }
      Object.assign(sweep, {
        sweepSecondNodeId: analysis.sweepSecondNodeId,
        sweepSecondParameter: analysis.sweepSecondParameter,
        sweepSecondStart,
        sweepSecondStop,
        sweepSecondPoints,
      })
    }
  }
  if (
    analysis.sweepConstraintMetric !== undefined &&
    analysis.sweepConstraintMetric !== null
  ) {
    if (
      !['s21Db', 'noiseFigureDb', 'inputP1Dbm', 'loadPowerDbm'].includes(
        analysis.sweepConstraintMetric as string,
      )
    ) {
      throw new ProjectFileError(
        'Optimization/yield constraint metric is invalid.',
      )
    }
    const sweepConstraintDirection =
      analysis.sweepConstraintDirection ?? 'minimum'
    if (
      sweepConstraintDirection !== 'minimum' &&
      sweepConstraintDirection !== 'maximum'
    ) {
      throw new ProjectFileError(
        'Optimization/yield constraint direction is invalid.',
      )
    }
    Object.assign(sweep, {
      sweepConstraintMetric:
        analysis.sweepConstraintMetric as RFAnalysisSettings['sweepConstraintMetric'],
      sweepConstraintDirection,
      sweepConstraintValue: finiteNumber(
        analysis.sweepConstraintValue,
        'analysis.sweepConstraintValue',
      ),
    })
  }
  return {
    startHz,
    stopHz,
    points,
    referenceImpedanceOhm,
    monteCarloRuns,
    monteCarloSeed,
    ...sweep,
  }
}

function validateAssets(value: unknown): Record<string, RFEmbeddedAsset> {
  const source = record(value, 'assets')
  const assets: Record<string, RFEmbeddedAsset> = {}
  for (const [assetId, assetValue] of Object.entries(source)) {
    safeKey(assetId, 'asset ID')
    const asset = record(assetValue, `assets.${assetId}`)
    if (asset.mediaType !== 'text/plain') {
      throw new ProjectFileError(`Asset "${assetId}" must use text/plain.`)
    }
    assets[assetId] = {
      fileName: boundedString(
        asset.fileName,
        `assets.${assetId}.fileName`,
        500,
      ),
      mediaType: 'text/plain',
      content: boundedString(
        asset.content,
        `assets.${assetId}.content`,
        MAX_PROJECT_FILE_CHARACTERS,
      ),
    }
  }
  return assets
}

function validateJsonRecord(
  value: unknown,
  path: string,
  depth: number,
): Record<string, unknown> {
  const source = record(value, path)
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(source)) {
    safeKey(key, path)
    result[key] = validateJsonValue(item, `${path}.${key}`, depth + 1)
  }
  return result
}

function validateJsonValue(
  value: unknown,
  path: string,
  depth: number,
): unknown {
  if (depth > 20)
    throw new ProjectFileError(`${path} exceeds maximum nesting depth.`)
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value
  }
  if (typeof value === 'number') return finiteNumber(value, path)
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      validateJsonValue(item, `${path}[${index}]`, depth + 1),
    )
  }
  return validateJsonRecord(value, path, depth + 1)
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProjectFileError(`${path} must be an object.`)
  }
  return value as Record<string, unknown>
}

function array(value: unknown, path: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new ProjectFileError(
      `${path} must be an array with at most ${maximum} items.`,
    )
  }
  return value
}

function boundedString(value: unknown, path: string, maximum: number): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximum
  ) {
    throw new ProjectFileError(
      `${path} must be a non-empty string with at most ${maximum} characters.`,
    )
  }
  return value
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ProjectFileError(`${path} must be a finite number.`)
  }
  return value
}

function ensureUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new ProjectFileError(`Every ${label} must be unique.`)
  }
}

function safeKey(key: string, path: string): void {
  if (UNSAFE_KEYS.has(key)) {
    throw new ProjectFileError(`${path} contains unsafe key "${key}".`)
  }
}
