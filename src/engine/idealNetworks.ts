import { fromPolar } from './complex'
import type { ComplexArray, TwoPortNetwork } from './types'

export function createThroughNetwork(
  frequencyHz: Float64Array,
  referenceImpedanceOhm: number,
  sourceName = 'Ideal through',
): TwoPortNetwork {
  validateInputs(frequencyHz, referenceImpedanceOhm)
  const s21 = constantComplexArray(frequencyHz.length, 1, 0)
  const s12 = constantComplexArray(frequencyHz.length, 1, 0)
  return {
    frequencyHz,
    referenceImpedanceOhm,
    s11: constantComplexArray(frequencyHz.length, 0, 0),
    s21,
    s12,
    s22: constantComplexArray(frequencyHz.length, 0, 0),
    sourceName,
  }
}

export function createIdealAmplifier(
  frequencyHz: Float64Array,
  gainDb: number,
  phaseDeg: number,
  referenceImpedanceOhm: number,
  sourceName = 'Ideal amplifier',
): TwoPortNetwork {
  return createMatchedUnilateralNetwork(
    frequencyHz,
    gainDb,
    phaseDeg,
    referenceImpedanceOhm,
    sourceName,
  )
}

export function createIdealAttenuator(
  frequencyHz: Float64Array,
  attenuationDb: number,
  phaseDeg: number,
  referenceImpedanceOhm: number,
  sourceName = 'Ideal attenuator',
): TwoPortNetwork {
  if (!Number.isFinite(attenuationDb) || attenuationDb < 0) {
    throw new RangeError(
      'Attenuation must be a finite value greater than or equal to 0 dB.',
    )
  }
  return createMatchedUnilateralNetwork(
    frequencyHz,
    -attenuationDb,
    phaseDeg,
    referenceImpedanceOhm,
    sourceName,
  )
}

function createMatchedUnilateralNetwork(
  frequencyHz: Float64Array,
  gainDb: number,
  phaseDeg: number,
  referenceImpedanceOhm: number,
  sourceName: string,
): TwoPortNetwork {
  validateInputs(frequencyHz, referenceImpedanceOhm)
  if (!Number.isFinite(gainDb) || !Number.isFinite(phaseDeg)) {
    throw new RangeError('Gain and phase must be finite values.')
  }
  const transmission = fromPolar(10 ** (gainDb / 20), phaseDeg)
  return {
    frequencyHz,
    referenceImpedanceOhm,
    s11: constantComplexArray(frequencyHz.length, 0, 0),
    s21: constantComplexArray(
      frequencyHz.length,
      transmission.re,
      transmission.im,
    ),
    s12: constantComplexArray(frequencyHz.length, 0, 0),
    s22: constantComplexArray(frequencyHz.length, 0, 0),
    sourceName,
  }
}

function constantComplexArray(
  length: number,
  re: number,
  im: number,
): ComplexArray {
  const values: ComplexArray = {
    re: new Float64Array(length),
    im: new Float64Array(length),
  }
  values.re.fill(re)
  values.im.fill(im)
  return values
}

function validateInputs(
  frequencyHz: Float64Array,
  referenceImpedanceOhm: number,
): void {
  if (frequencyHz.length === 0)
    throw new RangeError('Frequency grid cannot be empty.')
  if (!Number.isFinite(referenceImpedanceOhm) || referenceImpedanceOhm <= 0) {
    throw new RangeError('Reference impedance must be a positive finite value.')
  }
}
