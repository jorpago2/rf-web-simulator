import { describe, expect, it } from 'vitest'
import {
  createIdealAttenuator,
  createIdealDivider,
  createThroughNetwork,
} from './idealNetworks'
import {
  solveNPortInterconnection,
  solveNPortNoiseCorrelationAt,
  solveNPortWaveAt,
} from './interconnect'
import { twoPortToNPort } from './nport'

describe('N-port graph interconnection', () => {
  it('recombines two equal coherent branches into an ideal through', () => {
    const frequencyHz = new Float64Array([1e9, 2e9])
    const splitter = createIdealDivider(
      frequencyHz,
      0,
      0,
      0,
      0,
      300,
      50,
      'splitter',
    )
    const combiner = createIdealDivider(
      frequencyHz,
      2,
      0,
      0,
      0,
      300,
      50,
      'combiner',
    )
    const result = solveNPortInterconnection(
      [
        {
          nodeId: 'split',
          portIds: ['input', 'output-1', 'output-2'],
          network: splitter,
        },
        {
          nodeId: 'combine',
          portIds: ['input-1', 'input-2', 'output'],
          network: combiner,
        },
      ],
      [
        {
          first: { nodeId: 'split', portId: 'output-1' },
          second: { nodeId: 'combine', portId: 'input-1' },
        },
        {
          first: { nodeId: 'split', portId: 'output-2' },
          second: { nodeId: 'combine', portId: 'input-2' },
        },
      ],
      { nodeId: 'split', portId: 'input' },
      { nodeId: 'combine', portId: 'output' },
      50,
    )

    expect(result.s21.re[0]).toBeCloseTo(1, 12)
    expect(result.s21.im[0]).toBeCloseTo(0, 12)
    expect(result.s11.re[0]).toBeCloseTo(0, 12)
  })

  it('propagates block noise-wave correlations through connected ports', () => {
    const frequencyHz = new Float64Array([1e9])
    const attenuator = twoPortToNPort(
      createIdealAttenuator(frequencyHz, 3.01029995664, 0, 50),
    )
    const through = twoPortToNPort(createThroughNetwork(frequencyHz, 50))
    const blocks = [
      {
        nodeId: 'attenuator',
        portIds: ['input', 'output'],
        network: attenuator,
        noiseCorrelationAt: () => [
          { re: 0.5, im: 0 },
          { re: 0, im: 0 },
          { re: 0, im: 0 },
          { re: 0.5, im: 0 },
        ],
      },
      {
        nodeId: 'through',
        portIds: ['input', 'output'],
        network: through,
        noiseCorrelationAt: () =>
          Array.from({ length: 4 }, () => ({ re: 0, im: 0 })),
      },
    ]
    const correlation = solveNPortNoiseCorrelationAt(
      blocks,
      [
        {
          first: { nodeId: 'attenuator', portId: 'output' },
          second: { nodeId: 'through', portId: 'input' },
        },
      ],
      { nodeId: 'attenuator', portId: 'input' },
      { nodeId: 'through', portId: 'output' },
      50,
      0,
    )
    expect(correlation?.[3]?.re).toBeCloseTo(0.5, 12)
    const observed = solveNPortWaveAt(
      blocks,
      [
        {
          first: { nodeId: 'attenuator', portId: 'output' },
          second: { nodeId: 'through', portId: 'input' },
        },
      ],
      { nodeId: 'attenuator', portId: 'input' },
      { nodeId: 'through', portId: 'output' },
      { nodeId: 'through', portId: 'output' },
      50,
    )
    expect(observed.re[0]).toBeCloseTo(Math.SQRT1_2, 10)
  })
})
