import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  TouchstoneParseError,
  parseTouchstone,
  parseTouchstoneS2P,
} from './touchstone'

describe('Touchstone parser', () => {
  it('parses RI data from a split-line fixture', () => {
    const text = readFileSync(
      new URL('../test/fixtures/ideal-through.s2p', import.meta.url),
      'utf8',
    )
    const network = parseTouchstoneS2P(text, 'ideal-through.s2p')

    expect(network.frequencyHz).toEqual(new Float64Array([1e9, 2e9]))
    expect(network.referenceImpedanceOhm).toBe(50)
    expect(network.s21.re).toEqual(new Float64Array([1, 1]))
    expect(network.s21.im).toEqual(new Float64Array([0, 0]))
    expect(network.sourceName).toBe('ideal-through.s2p')
  })

  it.each([
    ['MA', '# MHz S MA R 75\n1 1 90 0 0 0 0 0 0', 0, 1],
    ['DB', '# KHZ S DB R 50\n1000 -6.020599913 180 0 0 0 0 0 0', -0.5, 0],
  ])(
    'converts %s magnitude/angle data to Cartesian form',
    (_, text, re, im) => {
      const network = parseTouchstoneS2P(text)
      expect(network.s11.re[0]).toBeCloseTo(re, 10)
      expect(network.s11.im[0]).toBeCloseTo(im, 10)
      expect(network.frequencyHz[0]).toBe(1e6)
    },
  )

  it('uses the Touchstone defaults when the option line is omitted', () => {
    const network = parseTouchstoneS2P('1 0 0 1 0 0 0 0 0')
    expect(network.frequencyHz[0]).toBe(1e9)
    expect(network.format).toBe('MA')
    expect(network.referenceImpedanceOhm).toBe(50)
  })

  it.each([
    ['HZ', 1],
    ['KHZ', 1e3],
    ['MHZ', 1e6],
    ['GHZ', 1e9],
  ])('converts %s frequencies to Hz', (unit, expectedFrequencyHz) => {
    const network = parseTouchstoneS2P(`# ${unit} S RI R 50\n1 0 0 1 0 0 0 0 0`)
    expect(network.frequencyHz[0]).toBe(expectedFrequencyHz)
  })

  it('requires the complete Touchstone 2.0 header', () => {
    expect(() => parseTouchstoneS2P('[Version] 2.0')).toThrow(/Touchstone 2.0/u)
  })

  it('parses a Touchstone 2.0 three-port full matrix in row-major order', () => {
    const network = parseTouchstone(
      `[Version] 2.0
# GHz S RI R 50
[Number of Ports] 3
[Number of Frequencies] 1
[Matrix Format] Full
[Network Data]
1 0 0 0.7071067811865476 0 0.7071067811865476 0
  0.7071067811865476 0 0 0 0 0
  0.7071067811865476 0 0 0 0 0
[End]`,
      'divider.s3p',
    )

    expect(network.portCount).toBe(3)
    expect(network.s[1]?.re[0]).toBeCloseTo(Math.SQRT1_2, 12)
    expect(network.s[3]?.re[0]).toBeCloseTo(Math.SQRT1_2, 12)
    expect(network.s[8]?.re[0]).toBe(0)
  })

  it('expands a symmetric lower matrix and keeps per-port references', () => {
    const network = parseTouchstone(
      `[Version] 2.0
# MHz S RI R 50
[Number of Ports] 3
[Number of Frequencies] 1
[Reference] 50 75 100
[Matrix Format] Lower
[Network Data]
100 0.1 0 0.2 0 0.3 0 0.4 0 0.5 0 0.6 0
[End]`,
      'symmetric.s3p',
    )

    expect(network.referenceImpedancesOhm).toEqual(
      new Float64Array([50, 75, 100]),
    )
    expect(network.s[1]?.re[0]).toBeCloseTo(0.2)
    expect(network.s[3]?.re[0]).toBeCloseTo(0.2)
    expect(network.s[7]?.re[0]).toBeCloseTo(0.5)
  })

  it('converts Z-parameters to S-parameters', () => {
    const network = parseTouchstone(
      `[Version] 2.0
# GHz Z RI R 50
[Number of Ports] 1
[Number of Frequencies] 1
[Network Data]
1 50 0
[End]`,
      'matched.s1p',
    )
    expect(network.s[0]?.re[0]).toBeCloseTo(0, 12)
    expect(network.s[0]?.im[0]).toBeCloseTo(0, 12)
  })

  it('imports version 2.0 noise parameters with physical resistance units', () => {
    const network = parseTouchstoneS2P(`[Version] 2.0
# GHz S RI R 50
[Number of Ports] 2
[Two-Port Data Order] 21_12
[Number of Frequencies] 1
[Number of Noise Frequencies] 1
[Network Data]
2 0 0 1 0 0 0 0 0
[Noise Data]
1 0.7 0.5 90 19
[End]`)

    expect(network.noise?.frequencyHz[0]).toBe(1e9)
    expect(network.noise?.optimumSourceReflection.re[0]).toBeCloseTo(0, 12)
    expect(network.noise?.optimumSourceReflection.im[0]).toBeCloseTo(0.5, 12)
    expect(network.noise?.effectiveNoiseResistanceOhm[0]).toBe(19)
  })

  it('reports malformed data with a useful line number', () => {
    expect(() =>
      parseTouchstoneS2P(
        '# GHz S RI R 50\n2 0 0 1 0 0 0 0 0\n1 0 0 1 0 0 0 0 0',
      ),
    ).toThrow(/strictly increasing.*line 3/u)
    expect(() => parseTouchstoneS2P('# GHz Z RI R 50\n')).toThrow(
      TouchstoneParseError,
    )
  })
})
