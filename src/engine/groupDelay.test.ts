import { describe, expect, it } from 'vitest'
import { deriveSimulationCurves, MIN_PLOT_MAGNITUDE_DB } from './derivedMetrics'
import { calculateGroupDelaySeconds, unwrapPhaseRadians } from './groupDelay'
import type { ComplexArray, TwoPortNetwork } from './types'

describe('phase unwrapping and group delay', () => {
  it('removes ±180° discontinuities without changing local slope', () => {
    const degrees = [170, -170, -160]
    const wrapped = new Float64Array(
      degrees.map((value) => (value * Math.PI) / 180),
    )
    const unwrapped = unwrapPhaseRadians(wrapped)

    expect([...unwrapped].map((value) => (value * 180) / Math.PI)).toEqual([
      expect.closeTo(170, 10),
      expect.closeTo(190, 10),
      expect.closeTo(200, 10),
    ])
  })

  it('recovers a known constant delay on a nonuniform frequency grid', () => {
    const expectedDelaySeconds = 1e-9
    const frequencyHz = new Float64Array([1e9, 1.1e9, 1.25e9, 1.4e9])
    const wrappedPhase = new Float64Array(
      [...frequencyHz].map((frequency) => {
        const phase = -2 * Math.PI * frequency * expectedDelaySeconds
        return Math.atan2(Math.sin(phase), Math.cos(phase))
      }),
    )
    const delay = calculateGroupDelaySeconds(
      frequencyHz,
      unwrapPhaseRadians(wrappedPhase),
    )

    for (const value of delay)
      expect(value).toBeCloseTo(expectedDelaySeconds, 15)
  })

  it('creates explicit gaps and a warning when S21 phase is undefined', () => {
    const zero = array([0, 0, 0], [0, 0, 0])
    const network: TwoPortNetwork = {
      frequencyHz: new Float64Array([1, 2, 3]),
      referenceImpedanceOhm: 50,
      s11: zero,
      s21: zero,
      s12: zero,
      s22: zero,
    }
    const result = deriveSimulationCurves(network)

    expect(result.curves.s21Db).toEqual(
      new Float64Array([
        MIN_PLOT_MAGNITUDE_DB,
        MIN_PLOT_MAGNITUDE_DB,
        MIN_PLOT_MAGNITUDE_DB,
      ]),
    )
    expect(Number.isNaN(result.curves.s21PhaseDeg[0])).toBe(true)
    expect(result.warnings[0]?.code).toBe('S21_PHASE_UNDEFINED')
  })
})

function array(re: number[], im: number[]): ComplexArray {
  return { re: new Float64Array(re), im: new Float64Array(im) }
}
