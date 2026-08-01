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
