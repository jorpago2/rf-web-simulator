export type NodeId = string
export type EdgeId = string

export interface ComplexArray {
  re: Float64Array
  im: Float64Array
}

export interface TwoPortNetwork {
  frequencyHz: Float64Array
  referenceImpedanceOhm: number
  s11: ComplexArray
  s21: ComplexArray
  s12: ComplexArray
  s22: ComplexArray
  sourceName?: string
}

export type RFNodeType =
  | 'source'
  | 'touchstone2Port'
  | 'idealAmplifier'
  | 'idealAttenuator'
  | 'load'
  | 'probe'

export interface RFNodeData extends Record<string, unknown> {
  label: string
  type: RFNodeType
  parameters: Record<string, unknown>
}

export interface RFProjectNode {
  id: NodeId
  position: { x: number; y: number }
  data: RFNodeData
}

export interface RFProjectEdge {
  id: EdgeId
  source: NodeId
  target: NodeId
}

export interface RFAnalysisSettings {
  startHz: number
  stopHz: number
  points: number
  referenceImpedanceOhm: number
}

export interface RFEmbeddedAsset {
  fileName: string
  mediaType: 'text/plain'
  content: string
}

export interface RFProject {
  schemaVersion: 1
  name: string
  nodes: RFProjectNode[]
  edges: RFProjectEdge[]
  analysis: RFAnalysisSettings
  assets: Record<string, RFEmbeddedAsset>
}

export interface SimulationWarning {
  code: 'RANGE_CLIPPED' | 'CASCADE_NEAR_SINGULAR' | 'S21_PHASE_UNDEFINED'
  message: string
  frequencyHz?: number
}

export interface SimulationStageSummary {
  nodeId: NodeId
  label: string
  s21DbAtCenter: number
}

export interface SimulationProbeResult {
  nodeId: NodeId
  label: string
  s21Db: Float64Array
}

export interface SimulationInput {
  nodes: RFProjectNode[]
  edges: RFProjectEdge[]
  analysis: RFAnalysisSettings
}

export interface SimulationOutput {
  total: TwoPortNetwork
  curves: SimulationCurves
  stageSummaries: SimulationStageSummary[]
  probeResults: SimulationProbeResult[]
  warnings: SimulationWarning[]
}

export interface SimulationCurves {
  s11Db: Float64Array
  s21Db: Float64Array
  s12Db: Float64Array
  s22Db: Float64Array
  s21PhaseDeg: Float64Array
  s21GroupDelayS: Float64Array
}
