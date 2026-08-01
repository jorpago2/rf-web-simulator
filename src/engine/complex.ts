export interface Complex {
  re: number
  im: number
}

const MIN_DIVISOR_MAGNITUDE_SQUARED = 1e-30

export function add(a: Complex, b: Complex): Complex {
  return { re: a.re + b.re, im: a.im + b.im }
}

export function subtract(a: Complex, b: Complex): Complex {
  return { re: a.re - b.re, im: a.im - b.im }
}

export function multiply(a: Complex, b: Complex): Complex {
  return {
    re: a.re * b.re - a.im * b.im,
    im: a.re * b.im + a.im * b.re,
  }
}

export function divide(a: Complex, b: Complex): Complex {
  const denominator = b.re * b.re + b.im * b.im
  if (denominator < MIN_DIVISOR_MAGNITUDE_SQUARED) {
    throw new RangeError('Cannot divide by a complex value near zero.')
  }

  return {
    re: (a.re * b.re + a.im * b.im) / denominator,
    im: (a.im * b.re - a.re * b.im) / denominator,
  }
}

export function conjugate(value: Complex): Complex {
  return { re: value.re, im: -value.im }
}

export function magnitude(value: Complex): number {
  return Math.hypot(value.re, value.im)
}

export function magnitudeDb(value: Complex): number {
  return 20 * Math.log10(magnitude(value))
}

export function phaseRadians(value: Complex): number {
  return Math.atan2(value.im, value.re)
}

export function phaseDegrees(value: Complex): number {
  return (phaseRadians(value) * 180) / Math.PI
}

export function fromPolar(
  magnitudeValue: number,
  angleDegrees: number,
): Complex {
  const angleRadians = (angleDegrees * Math.PI) / 180
  return {
    re: magnitudeValue * Math.cos(angleRadians),
    im: magnitudeValue * Math.sin(angleRadians),
  }
}
