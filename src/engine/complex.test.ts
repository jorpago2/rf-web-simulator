import { describe, expect, it } from 'vitest'
import {
  add,
  conjugate,
  divide,
  fromPolar,
  magnitude,
  magnitudeDb,
  multiply,
  phaseDegrees,
  subtract,
} from './complex'

describe('complex arithmetic', () => {
  const a = { re: 3, im: 4 }
  const b = { re: 1, im: -2 }

  it('performs the basic operations', () => {
    expect(add(a, b)).toEqual({ re: 4, im: 2 })
    expect(subtract(a, b)).toEqual({ re: 2, im: 6 })
    expect(multiply(a, b)).toEqual({ re: 11, im: -2 })
    expect(divide(a, b)).toEqual({ re: -1, im: 2 })
    expect(conjugate(a)).toEqual({ re: 3, im: -4 })
  })

  it('converts between Cartesian and polar representations', () => {
    expect(magnitude(a)).toBe(5)
    expect(magnitudeDb({ re: 0.5, im: 0 })).toBeCloseTo(-6.0206, 4)
    expect(phaseDegrees({ re: 0, im: 1 })).toBeCloseTo(90)
    expect(fromPolar(2, 180)).toEqual({
      re: expect.closeTo(-2, 12),
      im: expect.closeTo(0, 12),
    })
  })

  it('rejects division by a near-zero value', () => {
    expect(() => divide(a, { re: 1e-20, im: 0 })).toThrow(RangeError)
  })
})
