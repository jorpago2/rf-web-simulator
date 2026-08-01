import type { RFNodeData, RFNodeType } from '../engine/types'

export interface BlockDescriptor {
  type: RFNodeType
  label: string
  description: string
  symbol: string
  accent: string
  defaultParameters: Record<string, unknown>
}

export const blockDescriptors: readonly BlockDescriptor[] = [
  {
    type: 'source',
    label: 'RF source',
    description: 'Signal origin',
    symbol: 'SRC',
    accent: '#48b8a5',
    defaultParameters: {
      centerFrequencyHz: 1e9,
      powerDbm: 0,
      twoToneSpacingHz: 10e6,
      sourceImpedanceOhm: 50,
    },
  },
  {
    type: 'touchstone2Port',
    label: 'Touchstone N-port',
    description: 'Local .sNp network',
    symbol: 'SNP',
    accent: '#6ea8fe',
    defaultParameters: {},
  },
  {
    type: 'idealAmplifier',
    label: 'Active amplifier',
    description: 'Active gain and limits',
    symbol: 'AMP',
    accent: '#f1b75b',
    defaultParameters: {
      gainDb: 10,
      phaseDeg: 0,
      noiseFigureDb: 2,
      outputP1Dbm: 20,
      outputIp3Dbm: 35,
      im3PhaseDeg: 0,
      referenceImpedanceOhm: 50,
    },
  },
  {
    type: 'idealAttenuator',
    label: 'Ideal attenuator',
    description: 'Matched insertion loss',
    symbol: 'ATT',
    accent: '#ee7b65',
    defaultParameters: {
      attenuationDb: 3,
      phaseDeg: 0,
      referenceImpedanceOhm: 50,
    },
  },
  {
    type: 'idealMixer',
    label: 'Ideal mixer',
    description: 'Conversion and spur planning',
    symbol: 'MIX',
    accent: '#4b8fd8',
    defaultParameters: {
      loFrequencyHz: 0.7e9,
      mixerMode: 'downconvert',
      conversionLossDb: 7,
      noiseFigureDb: 7,
      outputP1Dbm: 10,
      outputIp3Dbm: 20,
      im3PhaseDeg: 0,
      referenceImpedanceOhm: 50,
    },
  },
  {
    type: 'idealSplitter',
    label: '2-way splitter',
    description: 'Reciprocal three-port divider',
    symbol: '÷2',
    accent: '#2da8c7',
    defaultParameters: {
      excessLossDb: 0,
      amplitudeImbalanceDb: 0,
      phaseImbalanceDeg: 0,
      isolationDb: 120,
      referenceImpedanceOhm: 50,
    },
  },
  {
    type: 'idealCombiner',
    label: '2-way combiner',
    description: 'Reciprocal three-port combiner',
    symbol: '×2',
    accent: '#2da8c7',
    defaultParameters: {
      excessLossDb: 0,
      amplitudeImbalanceDb: 0,
      phaseImbalanceDeg: 0,
      isolationDb: 120,
      referenceImpedanceOhm: 50,
    },
  },
  {
    type: 'probe',
    label: 'Probe',
    description: 'Accumulated result point',
    symbol: 'PRB',
    accent: '#a98bea',
    defaultParameters: {},
  },
  {
    type: 'load',
    label: 'Load',
    description: 'Chain termination',
    symbol: '50Ω',
    accent: '#8d9aa8',
    defaultParameters: {
      referenceImpedanceOhm: 50,
      loadImpedanceOhm: 50,
    },
  },
]

export function getBlockDescriptor(type: RFNodeType): BlockDescriptor {
  const descriptor = blockDescriptors.find(
    (candidate) => candidate.type === type,
  )
  if (!descriptor) throw new Error(`Unknown RF block type: ${type}`)
  return descriptor
}

export function createNodeData(type: RFNodeType): RFNodeData {
  const descriptor = getBlockDescriptor(type)
  return {
    label: descriptor.label,
    type,
    parameters: { ...descriptor.defaultParameters },
  }
}
