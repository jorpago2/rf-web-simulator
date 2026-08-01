const TWO_PI = 2 * Math.PI

export function unwrapPhaseRadians(
  wrappedPhaseRadians: Float64Array,
): Float64Array {
  const unwrapped = new Float64Array(wrappedPhaseRadians.length)
  let previousWrapped = Number.NaN
  let offset = 0

  for (let index = 0; index < wrappedPhaseRadians.length; index += 1) {
    const currentWrapped = wrappedPhaseRadians[index]!
    if (!Number.isFinite(currentWrapped)) {
      unwrapped[index] = Number.NaN
      previousWrapped = Number.NaN
      offset = 0
      continue
    }

    if (Number.isFinite(previousWrapped)) {
      const jump = currentWrapped - previousWrapped
      if (jump > Math.PI) offset -= TWO_PI
      else if (jump < -Math.PI) offset += TWO_PI
    }

    unwrapped[index] = currentWrapped + offset
    previousWrapped = currentWrapped
  }

  return unwrapped
}

export function calculateGroupDelaySeconds(
  frequencyHz: Float64Array,
  unwrappedPhaseRadians: Float64Array,
): Float64Array {
  if (
    frequencyHz.length < 2 ||
    frequencyHz.length !== unwrappedPhaseRadians.length
  ) {
    throw new RangeError(
      'Group delay requires matching frequency and phase arrays with at least two points.',
    )
  }
  for (let index = 0; index < frequencyHz.length; index += 1) {
    if (
      !Number.isFinite(frequencyHz[index]) ||
      (index > 0 && frequencyHz[index]! <= frequencyHz[index - 1]!)
    ) {
      throw new RangeError(
        'Group-delay frequencies must be finite and strictly increasing.',
      )
    }
  }

  const groupDelaySeconds = new Float64Array(frequencyHz.length)
  groupDelaySeconds.fill(Number.NaN)

  for (let index = 0; index < frequencyHz.length; index += 1) {
    const phase = unwrappedPhaseRadians[index]!
    if (!Number.isFinite(phase)) continue

    const hasLeft =
      index > 0 && Number.isFinite(unwrappedPhaseRadians[index - 1])
    const hasRight =
      index < frequencyHz.length - 1 &&
      Number.isFinite(unwrappedPhaseRadians[index + 1])

    if (hasLeft && hasRight) {
      groupDelaySeconds[index] = slopeToDelay(
        unwrappedPhaseRadians[index - 1]!,
        unwrappedPhaseRadians[index + 1]!,
        frequencyHz[index - 1]!,
        frequencyHz[index + 1]!,
      )
    } else if (hasRight) {
      groupDelaySeconds[index] = slopeToDelay(
        phase,
        unwrappedPhaseRadians[index + 1]!,
        frequencyHz[index]!,
        frequencyHz[index + 1]!,
      )
    } else if (hasLeft) {
      groupDelaySeconds[index] = slopeToDelay(
        unwrappedPhaseRadians[index - 1]!,
        phase,
        frequencyHz[index - 1]!,
        frequencyHz[index]!,
      )
    }
  }

  return groupDelaySeconds
}

function slopeToDelay(
  phaseStartRadians: number,
  phaseStopRadians: number,
  frequencyStartHz: number,
  frequencyStopHz: number,
): number {
  return (
    -(phaseStopRadians - phaseStartRadians) /
    (TWO_PI * (frequencyStopHz - frequencyStartHz))
  )
}
