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
  | 'idealMixer'
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
  schemaVersion: 2
  name: string
  nodes: RFProjectNode[]
  edges: RFProjectEdge[]
  analysis: RFAnalysisSettings
  assets: Record<string, RFEmbeddedAsset>
}

export type MixerMode = 'downconvert' | 'upconvert'

export interface FrequencyRange {
  startHz: number
  centerHz: number
  stopHz: number
}

export interface MixerProduct {
  label: string
  formula: string
  frequencyHz: number
  order: number
  kind: 'desired' | 'alternate' | 'feedthrough' | 'leakage' | 'spur'
}

export interface FrequencyConversionStage {
  nodeId: NodeId
  label: string
  mode: MixerMode
  loFrequencyHz: number
  input: FrequencyRange
  output: FrequencyRange
  imageLocation: 'input' | 'output'
  imageFrequencyHz: number | null
  imageRejectionDb: number | null
  loPowerDbm: number | null
  loToOutputIsolationDb: number | null
  estimatedLoLeakagePowerDbm: number | null
  products: MixerProduct[]
}

export interface FrequencyPlanResult {
  input: FrequencyRange
  output: FrequencyRange
  outputFrequencyHz: Float64Array
  stages: FrequencyConversionStage[]
}

export interface SimulationWarning {
  code:
    | 'RANGE_CLIPPED'
    | 'CASCADE_NEAR_SINGULAR'
    | 'S21_PHASE_UNDEFINED'
    | 'FREQUENCY_CONVERSION_MODEL'
    | 'NONLINEAR_MODEL'
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

export interface RFBudgetStage {
  nodeId: NodeId
  label: string
  type: RFNodeType
  stageGainDb: number | null
  cumulativeGainDb: number | null
  outputPowerDbm: number | null
  cumulativeNoiseFigureDb: number | null
  cumulativeInputP1Dbm: number | null
  cumulativeOutputP1Dbm: number | null
  cumulativeInputIp3Dbm: number | null
  cumulativeOutputIp3Dbm: number | null
}

export interface RFBudgetResult {
  centerFrequencyHz: number
  sourcePowerDbm: number | null
  stages: RFBudgetStage[]
  warnings: string[]
}

export interface NonlinearSweepResult {
  available: boolean
  inputPowerDbm: Float64Array
  linearOutputPowerDbm: Float64Array
  compressedOutputPowerDbm: Float64Array
  im3OutputPowerDbm: Float64Array
  smallSignalGainDb: number | null
  inputP1Dbm: number | null
  outputP1Dbm: number | null
  outputIp3Dbm: number | null
  operatingInputPowerDbm: number | null
  operatingOutputPowerDbm: number | null
  toneSpacingHz: number
  toneFrequenciesHz: [number, number]
  im3FrequenciesHz: [number, number]
  limitingStageLabel: string | null
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
  budget: RFBudgetResult
  nonlinear: NonlinearSweepResult
  frequencyPlan: FrequencyPlanResult
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
