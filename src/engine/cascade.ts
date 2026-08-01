import {
  add,
  divide,
  magnitude,
  multiply,
  subtract,
  type Complex,
} from './complex'
import type { ComplexArray, SimulationWarning, TwoPortNetwork } from './types'

export interface CascadeResult {
  network: TwoPortNetwork
  warnings: SimulationWarning[]
}

export const DEFAULT_CASCADE_SINGULARITY_TOLERANCE = 1e-12

/**
 * Cascades A followed by B with the two-port Redheffer star product.
 * Both ports use the same real reference impedance and wave normalization.
 */
export function cascadeTwoPorts(
  upstream: TwoPortNetwork,
  downstream: TwoPortNetwork,
  singularityTolerance = DEFAULT_CASCADE_SINGULARITY_TOLERANCE,
): CascadeResult {
  validateCompatibleNetworks(upstream, downstream)
  if (!Number.isFinite(singularityTolerance) || singularityTolerance <= 0) {
    throw new RangeError(
      'Cascade singularity tolerance must be positive and finite.',
    )
  }

  const length = upstream.frequencyHz.length
  const s11 = createComplexArray(length)
  const s21 = createComplexArray(length)
  const s12 = createComplexArray(length)
  const s22 = createComplexArray(length)
  const warnings: SimulationWarning[] = []

  for (let index = 0; index < length; index += 1) {
    const a11 = readComplex(upstream.s11, index)
    const a21 = readComplex(upstream.s21, index)
    const a12 = readComplex(upstream.s12, index)
    const a22 = readComplex(upstream.s22, index)
    const b11 = readComplex(downstream.s11, index)
    const b21 = readComplex(downstream.s21, index)
    const b12 = readComplex(downstream.s12, index)
    const b22 = readComplex(downstream.s22, index)

    let denominator = subtract({ re: 1, im: 0 }, multiply(a22, b11))
    if (magnitude(denominator) < singularityTolerance) {
      const phase = Math.atan2(denominator.im, denominator.re)
      denominator = {
        re: singularityTolerance * Math.cos(phase),
        im: singularityTolerance * Math.sin(phase),
      }
      warnings.push({
        code: 'CASCADE_NEAR_SINGULAR',
        frequencyHz: upstream.frequencyHz[index],
        message: `Cascade denominator regularized near ${formatFrequency(upstream.frequencyHz[index]!)}.`,
      })
    }

    const result11 = add(
      a11,
      divide(multiply(multiply(a12, b11), a21), denominator),
    )
    const result21 = divide(multiply(b21, a21), denominator)
    const result12 = divide(multiply(a12, b12), denominator)
    const result22 = add(
      b22,
      divide(multiply(multiply(b21, a22), b12), denominator),
    )

    writeFiniteComplex(s11, index, result11, upstream.frequencyHz[index]!)
    writeFiniteComplex(s21, index, result21, upstream.frequencyHz[index]!)
    writeFiniteComplex(s12, index, result12, upstream.frequencyHz[index]!)
    writeFiniteComplex(s22, index, result22, upstream.frequencyHz[index]!)
  }

  return {
    network: {
      frequencyHz: upstream.frequencyHz,
      referenceImpedanceOhm: upstream.referenceImpedanceOhm,
      s11,
      s21,
      s12,
      s22,
      sourceName: `${upstream.sourceName ?? 'Network A'} → ${downstream.sourceName ?? 'Network B'}`,
    },
    warnings,
  }
}

function validateCompatibleNetworks(
  upstream: TwoPortNetwork,
  downstream: TwoPortNetwork,
): void {
  const length = upstream.frequencyHz.length
  if (length === 0 || downstream.frequencyHz.length !== length) {
    throw new RangeError(
      'Cascaded networks must use the same non-empty frequency grid.',
    )
  }

  const impedanceScale = Math.max(
    1,
    Math.abs(upstream.referenceImpedanceOhm),
    Math.abs(downstream.referenceImpedanceOhm),
  )
  if (
    Math.abs(
      upstream.referenceImpedanceOhm - downstream.referenceImpedanceOhm,
    ) >
    impedanceScale * 1e-12
  ) {
    throw new RangeError(
      `Reference impedance mismatch: ${upstream.referenceImpedanceOhm} Ω versus ${downstream.referenceImpedanceOhm} Ω. Renormalization is not implemented.`,
    )
  }

  for (let index = 0; index < length; index += 1) {
    if (upstream.frequencyHz[index] !== downstream.frequencyHz[index]) {
      throw new RangeError(
        'Cascaded networks must use identical frequency values.',
      )
    }
    for (const parameter of ['s11', 's21', 's12', 's22'] as const) {
      if (
        upstream[parameter].re.length !== length ||
        upstream[parameter].im.length !== length ||
        downstream[parameter].re.length !== length ||
        downstream[parameter].im.length !== length
      ) {
        throw new RangeError(
          'S-parameter array length does not match the frequency grid.',
        )
      }
    }
  }
}

function createComplexArray(length: number): ComplexArray {
  return { re: new Float64Array(length), im: new Float64Array(length) }
}

function readComplex(values: ComplexArray, index: number): Complex {
  return { re: values.re[index]!, im: values.im[index]! }
}

function writeFiniteComplex(
  destination: ComplexArray,
  index: number,
  value: Complex,
  frequencyHz: number,
): void {
  if (!Number.isFinite(value.re) || !Number.isFinite(value.im)) {
    throw new RangeError(
      `Cascade produced a non-finite value at ${frequencyHz} Hz.`,
    )
  }
  destination.re[index] = value.re
  destination.im[index] = value.im
}

function formatFrequency(frequencyHz: number): string {
  return frequencyHz >= 1e9
    ? `${frequencyHz / 1e9} GHz`
    : `${frequencyHz / 1e6} MHz`
}
