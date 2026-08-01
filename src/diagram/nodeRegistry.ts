import type { RFNodeData, RFNodeType } from '../engine/types'

export interface BlockDescriptor {
  type: RFNodeType
  label: string
  description: string
  accent: string
  defaultParameters: Record<string, unknown>
}

export const blockDescriptors: readonly BlockDescriptor[] = [
  {
    type: 'source',
    label: 'RF source',
    description: 'Signal origin',
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
    accent: '#6ea8fe',
    defaultParameters: {},
  },
  {
    type: 'idealAmplifier',
    label: 'Active amplifier',
    description: 'Active gain and limits',
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
    accent: '#ee7b65',
    defaultParameters: {
      attenuationDb: 3,
      phaseDeg: 0,
      referenceImpedanceOhm: 50,
    },
  },
  {
    type: 'idealFilter',
    label: 'Butterworth filter',
    description: 'LP / HP / BP / BS response',
    accent: '#5b8def',
    defaultParameters: {
      filterType: 'bandpass',
      cutoffFrequencyHz: 1e9,
      centerFrequencyHz: 1e9,
      bandwidthHz: 200e6,
      order: 3,
      insertionLossDb: 1,
      referenceImpedanceOhm: 50,
    },
  },
  {
    type: 'idealPhaseShifter',
    label: 'Phase shifter',
    description: 'Matched narrowband phase shift',
    accent: '#936dcc',
    defaultParameters: {
      phaseDeg: 90,
      insertionLossDb: 1,
      referenceImpedanceOhm: 50,
    },
  },
  {
    type: 'idealIsolator',
    label: 'Isolator',
    description: 'Non-reciprocal forward path',
    accent: '#d48145',
    defaultParameters: {
      forwardLossDb: 1,
      reverseIsolationDb: 30,
      phaseDeg: 0,
      referenceImpedanceOhm: 50,
    },
  },
  {
    type: 'idealRFSwitch',
    label: 'RF switch',
    description: 'Reciprocal ON / OFF path',
    accent: '#db6e57',
    defaultParameters: {
      enabled: true,
      insertionLossDb: 1,
      isolationDb: 40,
      phaseDeg: 0,
      referenceImpedanceOhm: 50,
    },
  },
  {
    type: 'idealDirectionalCoupler',
    label: 'Directional coupler',
    description: 'Through and sampled outputs',
    accent: '#28a8a0',
    defaultParameters: {
      couplingDb: 20,
      excessLossDb: 0.5,
      referenceImpedanceOhm: 50,
    },
  },
  {
    type: 'idealDiplexer',
    label: 'LP / HP diplexer',
    description: 'Complementary frequency split',
    accent: '#537ed6',
    defaultParameters: {
      crossoverFrequencyHz: 1e9,
      order: 3,
      insertionLossDb: 1,
      referenceImpedanceOhm: 50,
    },
  },
  {
    type: 'transmissionLine',
    label: 'Transmission line',
    description: 'Delay and matched loss',
    accent: '#3b9aa3',
    defaultParameters: {
      delayS: 1e-9,
      insertionLossDb: 0.5,
      referenceImpedanceOhm: 50,
    },
  },
  {
    type: 'matchingNetwork',
    label: 'L / π / T matching',
    description: 'Lumped impedance network',
    accent: '#5c82c8',
    defaultParameters: {
      topology: 'l',
      response: 'lowpass',
      inductanceH: 10e-9,
      capacitanceF: 2.5e-12,
      componentQ: 100,
      referenceImpedanceOhm: 50,
    },
  },
  {
    type: 'idealBalun',
    label: '1:1 balun',
    description: 'Unbalanced to differential',
    accent: '#7b6fc2',
    defaultParameters: {
      excessLossDb: 1,
      amplitudeImbalanceDb: 0,
      phaseErrorDeg: 0,
      isolationDb: 120,
      referenceImpedanceOhm: 50,
    },
  },
  {
    type: 'vcoSource',
    label: 'Oscillator / VCO',
    description: 'Voltage-tuned RF source',
    accent: '#dc9f32',
    defaultParameters: {
      freeRunningFrequencyHz: 0.9e9,
      tuningSensitivityHzPerV: 100e6,
      controlVoltageV: 1,
      powerDbm: 10,
      sourceImpedanceOhm: 50,
    },
  },
  {
    type: 'rxAntenna',
    label: 'RX antenna',
    description: 'Received-signal source terminal',
    accent: '#43a887',
    defaultParameters: {
      centerFrequencyHz: 1e9,
      powerDbm: -80,
      sourceImpedanceOhm: 50,
    },
  },
  {
    type: 'txAntenna',
    label: 'TX antenna',
    description: 'Transmitter load terminal',
    accent: '#43a887',
    defaultParameters: {
      referenceImpedanceOhm: 50,
      loadImpedanceOhm: 50,
    },
  },
  {
    type: 'idealMixer',
    label: 'Ideal mixer',
    description: 'Conversion and spur planning',
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
    accent: '#a98bea',
    defaultParameters: {},
  },
  {
    type: 'load',
    label: 'Load',
    description: 'Chain termination',
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
