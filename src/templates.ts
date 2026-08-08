import { createNodeData } from './diagram/nodeRegistry'
import type {
  RFAnalysisSettings,
  RFNodeType,
  RFProject,
  RFProjectEdge,
  RFProjectNode,
} from './engine/types'

export interface RFTemplate {
  id: string
  label: string
  description: string
  project: RFProject
}

const analysis = (
  startHz: number,
  stopHz: number,
  points = 401,
): RFAnalysisSettings => ({
  startHz,
  stopHz,
  points,
  referenceImpedanceOhm: 50,
  monteCarloRuns: 0,
  monteCarloSeed: 1,
})

const node = (
  id: string,
  type: RFNodeType,
  x: number,
  label: string,
  parameters: Record<string, unknown> = {},
): RFProjectNode => {
  const data = createNodeData(type)
  return {
    id,
    position: { x, y: 120 },
    data: {
      ...data,
      label,
      parameters: { ...data.parameters, ...parameters },
    },
  }
}

const connect = (...nodeIds: string[]): RFProjectEdge[] =>
  nodeIds.slice(1).map((target, index) => ({
    id: `edge-${nodeIds[index]}-${target}`,
    source: nodeIds[index]!,
    target,
  }))

export const rfTemplates: readonly RFTemplate[] = [
  {
    id: 'tx-2g4',
    label: '2.4 GHz transmitter',
    description: 'VCO/PLL carrier chain with driver, PA, filtering and antenna',
    project: {
      schemaVersion: 3,
      name: 'Template · 2.4 GHz RF transmitter',
      analysis: analysis(2.35e9, 2.45e9),
      nodes: [
        node('tx-vco', 'vcoSource', 20, '2.4 GHz VCO', {
          freeRunningFrequencyHz: 2.3e9,
          tuningSensitivityHzPerV: 100e6,
          controlVoltageV: 1,
          powerDbm: -10,
          pllEnabled: true,
        }),
        node('tx-switch', 'idealRFSwitch', 210, 'TX switch', {
          insertionLossDb: 0.8,
          isolationDb: 50,
        }),
        node('tx-driver', 'idealAmplifier', 400, 'Driver', {
          gainDb: 12,
          noiseFigureDb: 4,
          outputP1Dbm: 18,
          outputIp3Dbm: 30,
        }),
        node('tx-filter', 'idealFilter', 590, '2.4 GHz BPF', {
          filterType: 'bandpass',
          centerFrequencyHz: 2.4e9,
          bandwidthHz: 100e6,
          order: 4,
          insertionLossDb: 1,
        }),
        node('tx-pa', 'idealAmplifier', 780, 'Power amp', {
          gainDb: 20,
          noiseFigureDb: 5,
          outputP1Dbm: 30,
          outputIp3Dbm: 42,
        }),
        node('tx-isolator', 'idealIsolator', 970, 'Isolator', {
          forwardLossDb: 0.8,
          reverseIsolationDb: 30,
        }),
        node('tx-line', 'transmissionLine', 1160, 'Feed line', {
          delayS: 2e-9,
          insertionLossDb: 0.7,
        }),
        node('tx-antenna', 'txAntenna', 1350, 'TX antenna'),
      ],
      edges: connect(
        'tx-vco',
        'tx-switch',
        'tx-driver',
        'tx-filter',
        'tx-pa',
        'tx-isolator',
        'tx-line',
        'tx-antenna',
      ),
      assets: {},
    },
  },
  {
    id: 'rx-915-superhet',
    label: '915 MHz superheterodyne RX',
    description: 'Preselector and LNA followed by 70 MHz IF conversion',
    project: {
      schemaVersion: 3,
      name: 'Template · 915 MHz superheterodyne receiver',
      analysis: analysis(907e6, 923e6),
      nodes: [
        node('sh-antenna', 'rxAntenna', 20, '915 MHz antenna', {
          centerFrequencyHz: 915e6,
          powerDbm: -95,
        }),
        node('sh-preselector', 'idealFilter', 220, '915 MHz BPF', {
          filterType: 'bandpass',
          centerFrequencyHz: 915e6,
          bandwidthHz: 26e6,
          order: 4,
          insertionLossDb: 1.5,
        }),
        node('sh-lna', 'idealAmplifier', 420, 'LNA', {
          gainDb: 18,
          noiseFigureDb: 1.2,
          outputP1Dbm: 12,
          outputIp3Dbm: 28,
        }),
        node('sh-mixer', 'idealMixer', 620, 'RF mixer', {
          loFrequencyHz: 845e6,
          mixerMode: 'downconvert',
          conversionLossDb: 7,
          noiseFigureDb: 7,
          outputP1Dbm: 5,
          outputIp3Dbm: 15,
        }),
        node('sh-if-filter', 'idealFilter', 820, '70 MHz BPF', {
          filterType: 'bandpass',
          centerFrequencyHz: 70e6,
          bandwidthHz: 10e6,
          order: 4,
          insertionLossDb: 2,
        }),
        node('sh-if-amp', 'idealAmplifier', 1020, 'IF amp', {
          gainDb: 25,
          noiseFigureDb: 3,
          outputP1Dbm: 18,
          outputIp3Dbm: 30,
        }),
        node('sh-load', 'load', 1220, '70 MHz IF load'),
      ],
      edges: connect(
        'sh-antenna',
        'sh-preselector',
        'sh-lna',
        'sh-mixer',
        'sh-if-filter',
        'sh-if-amp',
        'sh-load',
      ),
      assets: {},
    },
  },
  {
    id: 'rx-2g45-low-if',
    label: '2.45 GHz low-IF RX',
    description: '2.45 GHz front end converted to a 20 MHz low IF',
    project: {
      schemaVersion: 3,
      name: 'Template · 2.45 GHz low-IF receiver',
      analysis: analysis(2.44e9, 2.46e9),
      nodes: [
        node('lif-antenna', 'rxAntenna', 20, '2.45 GHz antenna', {
          centerFrequencyHz: 2.45e9,
          powerDbm: -85,
        }),
        node('lif-filter', 'idealFilter', 220, '2.45 GHz BPF', {
          filterType: 'bandpass',
          centerFrequencyHz: 2.45e9,
          bandwidthHz: 100e6,
          order: 3,
          insertionLossDb: 1.5,
        }),
        node('lif-lna', 'idealAmplifier', 420, 'LNA', {
          gainDb: 15,
          noiseFigureDb: 1.5,
          outputP1Dbm: 10,
          outputIp3Dbm: 25,
        }),
        node('lif-mixer', 'idealMixer', 620, 'Low-IF mixer', {
          loFrequencyHz: 2.43e9,
          mixerMode: 'downconvert',
          conversionLossDb: 7,
          noiseFigureDb: 7,
          outputP1Dbm: 5,
          outputIp3Dbm: 15,
        }),
        node('lif-lpf', 'idealFilter', 820, '30 MHz LPF', {
          filterType: 'lowpass',
          cutoffFrequencyHz: 30e6,
          order: 4,
          insertionLossDb: 1,
        }),
        node('lif-amp', 'idealAmplifier', 1020, 'IF amp', {
          gainDb: 25,
          noiseFigureDb: 4,
          outputP1Dbm: 18,
          outputIp3Dbm: 30,
        }),
        node('lif-load', 'load', 1220, '20 MHz low-IF load'),
      ],
      edges: connect(
        'lif-antenna',
        'lif-filter',
        'lif-lna',
        'lif-mixer',
        'lif-lpf',
        'lif-amp',
        'lif-load',
      ),
      assets: {},
    },
  },
]

export function getRFTemplate(id: string): RFProject {
  const template = rfTemplates.find((candidate) => candidate.id === id)
  if (!template) throw new Error(`Unknown RF template: ${id}`)
  return template.project
}
