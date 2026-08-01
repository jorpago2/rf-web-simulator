import { fromPolar } from './complex'
import { createNPortS } from './nport'
import type { ComplexArray, NPortNetwork, TwoPortNetwork } from './types'

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

export function createTabulatedAmplifier(
  frequencyHz: Float64Array,
  gainDb: Float64Array,
  phaseDeg: number,
  referenceImpedanceOhm: number,
  sourceName = 'Tabulated amplifier',
): TwoPortNetwork {
  validateInputs(frequencyHz, referenceImpedanceOhm)
  if (gainDb.length !== frequencyHz.length || !Number.isFinite(phaseDeg)) {
    throw new RangeError('Tabulated gain must match the frequency grid.')
  }
  const s21: ComplexArray = {
    re: new Float64Array(frequencyHz.length),
    im: new Float64Array(frequencyHz.length),
  }
  for (let index = 0; index < frequencyHz.length; index += 1) {
    if (!Number.isFinite(gainDb[index])) {
      throw new RangeError('Tabulated gain values must be finite.')
    }
    const value = fromPolar(10 ** (gainDb[index]! / 20), phaseDeg)
    s21.re[index] = value.re
    s21.im[index] = value.im
  }
  return {
    frequencyHz,
    referenceImpedanceOhm,
    s11: constantComplexArray(frequencyHz.length, 0, 0),
    s21,
    s12: constantComplexArray(frequencyHz.length, 0, 0),
    s22: constantComplexArray(frequencyHz.length, 0, 0),
    sourceName,
  }
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
  return createMatchedReciprocalNetwork(
    frequencyHz,
    -attenuationDb,
    phaseDeg,
    referenceImpedanceOhm,
    sourceName,
  )
}

function createMatchedReciprocalNetwork(
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
    s12: constantComplexArray(
      frequencyHz.length,
      transmission.re,
      transmission.im,
    ),
    s22: constantComplexArray(frequencyHz.length, 0, 0),
    sourceName,
  }
}

export function createIdealDivider(
  frequencyHz: Float64Array,
  commonPort: 0 | 2,
  excessLossDb: number,
  amplitudeImbalanceDb: number,
  phaseImbalanceDeg: number,
  isolationDb: number,
  referenceImpedanceOhm: number,
  sourceName: string,
): NPortNetwork {
  validateInputs(frequencyHz, referenceImpedanceOhm)
  if (
    !Number.isFinite(excessLossDb) ||
    excessLossDb < 0 ||
    !Number.isFinite(amplitudeImbalanceDb) ||
    !Number.isFinite(phaseImbalanceDeg) ||
    !Number.isFinite(isolationDb) ||
    isolationDb < 0
  ) {
    throw new RangeError(
      'Divider loss, imbalance, phase, and isolation are invalid.',
    )
  }
  const branchPorts: [number, number] = commonPort === 0 ? [1, 2] : [0, 1]
  const amplitudeRatio = 10 ** (amplitudeImbalanceDb / 20)
  const lossScale = 10 ** (-excessLossDb / 20)
  const first = lossScale / Math.sqrt(1 + amplitudeRatio * amplitudeRatio)
  const second = first * amplitudeRatio
  const firstValue = fromPolar(first, 0)
  const secondValue = fromPolar(second, phaseImbalanceDeg)
  const isolationValue = fromPolar(10 ** (-isolationDb / 20), 0)
  const s = createNPortS(3, frequencyHz.length)
  setConstantS(s, 3, commonPort, branchPorts[0], firstValue)
  setConstantS(s, 3, branchPorts[0], commonPort, firstValue)
  setConstantS(s, 3, commonPort, branchPorts[1], secondValue)
  setConstantS(s, 3, branchPorts[1], commonPort, secondValue)
  setConstantS(s, 3, branchPorts[0], branchPorts[1], isolationValue)
  setConstantS(s, 3, branchPorts[1], branchPorts[0], isolationValue)
  return {
    frequencyHz,
    portCount: 3,
    referenceImpedancesOhm: new Float64Array(3).fill(referenceImpedanceOhm),
    s,
    sourceName,
  }
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

function setConstantS(
  matrix: ComplexArray[],
  portCount: number,
  outputPort: number,
  inputPort: number,
  value: { re: number; im: number },
): void {
  matrix[outputPort * portCount + inputPort]!.re.fill(value.re)
  matrix[outputPort * portCount + inputPort]!.im.fill(value.im)
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
