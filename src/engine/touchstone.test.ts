import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TouchstoneParseError, parseTouchstoneS2P } from './touchstone'

describe('Touchstone 1.0 .s2p parser', () => {
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

  it('rejects Touchstone 2.0 keywords explicitly', () => {
    expect(() => parseTouchstoneS2P('[Version] 2.0')).toThrow(/Touchstone 2.0/u)
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
