import { calculateGroupDelaySeconds, unwrapPhaseRadians } from './groupDelay'
import type {
  ComplexArray,
  SimulationCurves,
  SimulationWarning,
  TwoPortNetwork,
} from './types'

export const MIN_PLOT_MAGNITUDE_DB = -300
export const MIN_PHASE_MAGNITUDE = 1e-15

export function deriveSimulationCurves(network: TwoPortNetwork): {
  curves: SimulationCurves
  warnings: SimulationWarning[]
} {
  const wrappedPhaseRadians = new Float64Array(network.frequencyHz.length)
  let undefinedPhaseCount = 0

  for (let index = 0; index < network.frequencyHz.length; index += 1) {
    const re = network.s21.re[index]!
    const im = network.s21.im[index]!
    if (Math.hypot(re, im) <= MIN_PHASE_MAGNITUDE) {
      wrappedPhaseRadians[index] = Number.NaN
      undefinedPhaseCount += 1
    } else {
      wrappedPhaseRadians[index] = Math.atan2(im, re)
    }
  }

  const unwrappedPhaseRadians = unwrapPhaseRadians(wrappedPhaseRadians)
  const s21PhaseDeg = new Float64Array(unwrappedPhaseRadians.length)
  for (let index = 0; index < unwrappedPhaseRadians.length; index += 1) {
    s21PhaseDeg[index] = (unwrappedPhaseRadians[index]! * 180) / Math.PI
  }

  const warnings: SimulationWarning[] = []
  if (undefinedPhaseCount > 0) {
    warnings.push({
      code: 'S21_PHASE_UNDEFINED',
      message: `S21 phase and group delay are undefined at ${undefinedPhaseCount} point(s) below magnitude ${MIN_PHASE_MAGNITUDE}. Plot gaps are shown.`,
    })
  }

  return {
    curves: {
      s11Db: magnitudeDbArray(network.s11),
      s21Db: magnitudeDbArray(network.s21),
      s12Db: magnitudeDbArray(network.s12),
      s22Db: magnitudeDbArray(network.s22),
      s21PhaseDeg,
      s21GroupDelayS: calculateGroupDelaySeconds(
        network.frequencyHz,
        unwrappedPhaseRadians,
      ),
    },
    warnings,
  }
}

function magnitudeDbArray(values: ComplexArray): Float64Array {
  if (values.re.length !== values.im.length) {
    throw new RangeError('Complex arrays must have matching lengths.')
  }
  const result = new Float64Array(values.re.length)
  for (let index = 0; index < values.re.length; index += 1) {
    const magnitude = Math.hypot(values.re[index]!, values.im[index]!)
    result[index] =
      magnitude === 0
        ? MIN_PLOT_MAGNITUDE_DB
        : Math.max(20 * Math.log10(magnitude), MIN_PLOT_MAGNITUDE_DB)
  }
  return result
}
