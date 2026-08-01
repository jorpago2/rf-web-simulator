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

export interface NPortNetwork {
  frequencyHz: Float64Array
  portCount: number
  referenceImpedancesOhm: Float64Array
  /** Row-major S matrix: index = outputPort * portCount + inputPort. */
  s: ComplexArray[]
  portLabels?: string[]
  sourceName?: string
}

export type RFNodeType =
  | 'source'
  | 'touchstone2Port'
  | 'idealAmplifier'
  | 'idealAttenuator'
  | 'idealFilter'
  | 'idealPhaseShifter'
  | 'idealIsolator'
  | 'idealMixer'
  | 'idealSplitter'
  | 'idealCombiner'
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
  sourceHandle?: string
  targetHandle?: string
}

export interface RFAnalysisSettings {
  startHz: number
  stopHz: number
  points: number
  referenceImpedanceOhm: number
  monteCarloRuns?: number
  monteCarloSeed?: number
  sweepNodeId?: string | null
  sweepParameter?: string | null
  sweepStart?: number
  sweepStop?: number
  sweepPoints?: number
  sweepMetric?: ParametricMetric
  sweepObjective?: 'minimize' | 'maximize'
  sweepSecondNodeId?: string | null
  sweepSecondParameter?: string | null
  sweepSecondStart?: number
  sweepSecondStop?: number
  sweepSecondPoints?: number
  sweepConstraintMetric?: ParametricMetric | null
  sweepConstraintDirection?: 'minimum' | 'maximum'
  sweepConstraintValue?: number
}

export interface RFEmbeddedAsset {
  fileName: string
  mediaType: 'text/plain'
  content: string
}

export interface RFProject {
  schemaVersion: 3
  name: string
  nodes: RFProjectNode[]
  edges: RFProjectEdge[]
  analysis: RFAnalysisSettings
  assets: Record<string, RFEmbeddedAsset>
}

export type MixerMode = 'downconvert' | 'upconvert'
export type IdealFilterType = 'lowpass' | 'highpass' | 'bandpass' | 'bandstop'

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
  inputCoefficient: number
  loCoefficient: number
  relativeLevelDb: number | null
  phaseDeg: number | null
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
  spectralLines: FrequencySpectralLine[]
}

export interface FrequencySpectralLine {
  frequencyHz: number
  powerDbm: number | null
  phaseDeg: number | null
  path: string
}

export interface SimulationWarning {
  code:
    | 'RANGE_CLIPPED'
    | 'CASCADE_NEAR_SINGULAR'
    | 'S21_PHASE_UNDEFINED'
    | 'FREQUENCY_CONVERSION_MODEL'
    | 'NONLINEAR_MODEL'
    | 'BRANCHED_NETWORK_MODEL'
    | 'PASSIVITY_ENFORCED'
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
  sourceImpedanceOhm: number
  loadImpedanceOhm: number
  transducerGainDb: number | null
  deliveredLoadPowerDbm: number | null
  cascadedNoiseFigureDb: number | null
  stages: RFBudgetStage[]
  warnings: string[]
}

export interface NonlinearSweepResult {
  available: boolean
  inputPowerDbm: Float64Array
  linearOutputPowerDbm: Float64Array
  compressedOutputPowerDbm: Float64Array
  outputPhaseDeg: Float64Array
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
  envelopeSpectrum: NonlinearSpectralLine[]
  spectrumInputPowerDbm: number | null
}

export interface NonlinearSpectralLine {
  index: number
  frequencyHz: number
  outputPowerDbm: number
  relativeToStrongestDb: number
  phaseDeg: number
  kind: 'fundamental' | 'im3' | 'higher-order'
}

export interface SimulationInput {
  nodes: RFProjectNode[]
  edges: RFProjectEdge[]
  analysis: RFAnalysisSettings
}

export interface SimulationOutput {
  total: TwoPortNetwork
  curves: SimulationCurves
  networkChecks: NetworkChecks
  stageSummaries: SimulationStageSummary[]
  probeResults: SimulationProbeResult[]
  budget: RFBudgetResult
  nonlinear: NonlinearSweepResult
  frequencyPlan: FrequencyPlanResult
  monteCarlo: MonteCarloResult
  parametricSweep: ParametricSweepResult
  warnings: SimulationWarning[]
}

export type ParametricMetric =
  's21Db' | 'noiseFigureDb' | 'inputP1Dbm' | 'loadPowerDbm'

export interface ParametricSweepResult {
  available: boolean
  nodeId: string | null
  nodeLabel: string | null
  parameter: string | null
  metric: ParametricMetric
  objective: 'minimize' | 'maximize'
  parameterValues: Float64Array
  metricValues: Float64Array
  bestParameterValue: number | null
  bestMetricValue: number | null
  variables: ParametricVariable[]
  samples: ParametricSample[]
  bestParameterValues: number[]
  constraint: ParametricConstraint | null
}

export interface ParametricVariable {
  nodeId: string
  nodeLabel: string
  parameter: string
  start: number
  stop: number
  points: number
}

export interface ParametricConstraint {
  metric: ParametricMetric
  direction: 'minimum' | 'maximum'
  value: number
}

export interface ParametricSample {
  parameterValues: number[]
  metricValue: number
  constraintValue: number | null
  feasible: boolean
}

export interface MonteCarloMetricSummary {
  key: 's21Db' | 'noiseFigureDb' | 'inputP1Dbm' | 'loadPowerDbm'
  label: string
  unit: 'dB' | 'dBm'
  mean: number
  standardDeviation: number
  percentile05: number
  percentile50: number
  percentile95: number
}

export interface MonteCarloResult {
  available: boolean
  runs: number
  seed: number
  metrics: MonteCarloMetricSummary[]
  sensitivities: MonteCarloSensitivity[]
  yieldPercent: number | null
  passingRuns: number | null
}

export interface MonteCarloSensitivity {
  parameter: string
  metricKey: MonteCarloMetricSummary['key']
  metricLabel: string
  correlation: number
}

export interface NetworkChecks {
  stabilityK: Float64Array
  stabilityMuSource: Float64Array
  stabilityMuLoad: Float64Array
  passivityMaximumSingularValue: Float64Array
  reciprocityErrorMagnitude: Float64Array
  /** Negative-time S21 impulse energy relative to total energy over the sampled band. */
  causalityPreEchoEnergyDb: number | null
  causalityTimeResolutionS: number | null
}

export interface SimulationCurves {
  s11Db: Float64Array
  s21Db: Float64Array
  s12Db: Float64Array
  s22Db: Float64Array
  s21PhaseDeg: Float64Array
  s21GroupDelayS: Float64Array
}
