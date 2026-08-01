import type { RFNodeType } from '../engine/types'

interface RFBlockSymbolProps {
  type: RFNodeType
  className?: string
}

export function RFBlockSymbol({ type, className }: RFBlockSymbolProps) {
  return (
    <svg
      aria-hidden="true"
      className={['rf-block-symbol', className].filter(Boolean).join(' ')}
      focusable="false"
      viewBox="0 0 64 44"
    >
      {symbolForType(type)}
    </svg>
  )
}

function symbolForType(type: RFNodeType) {
  switch (type) {
    case 'source':
      return (
        <>
          <path d="M2 22h9M47 22h15" />
          <circle className="rf-block-symbol__fill" cx="29" cy="22" r="18" />
          <path d="M16 22c4-10 8-10 12 0s8 10 13 0" />
        </>
      )
    case 'touchstone2Port':
      return (
        <>
          <path d="M2 12h10M2 32h10M52 12h10M52 32h10" />
          <rect
            className="rf-block-symbol__fill"
            x="12"
            y="5"
            width="40"
            height="34"
            rx="5"
          />
          <circle cx="18" cy="12" r="2" />
          <circle cx="18" cy="32" r="2" />
          <circle cx="46" cy="12" r="2" />
          <circle cx="46" cy="32" r="2" />
          <path d="M20 29c7-16 15 7 24-10" />
        </>
      )
    case 'idealAmplifier':
      return (
        <>
          <path d="M2 22h12M50 22h12" />
          <path className="rf-block-symbol__fill" d="M14 4v36l36-18z" />
        </>
      )
    case 'idealAttenuator':
      return (
        <>
          <path d="M2 22h12M50 22h12" />
          <rect
            className="rf-block-symbol__fill"
            x="14"
            y="8"
            width="36"
            height="28"
            rx="3"
          />
          <path d="m20 22 5-8 7 16 7-16 5 8" />
        </>
      )
    case 'idealFilter':
      return (
        <>
          <path d="M2 22h12M50 22h12" />
          <rect
            className="rf-block-symbol__fill"
            x="14"
            y="7"
            width="36"
            height="30"
            rx="4"
          />
          <path d="M20 30h5c3 0 3-16 7-16s4 16 7 16h5" />
        </>
      )
    case 'idealPhaseShifter':
      return (
        <>
          <path d="M2 22h14M48 22h14" />
          <circle className="rf-block-symbol__fill" cx="32" cy="22" r="16" />
          <path d="M23 29c2-11 5-15 9-15s7 4 9 15M25 25h14" />
        </>
      )
    case 'idealIsolator':
      return (
        <>
          <path d="M2 22h12M50 22h12M50 10v24" />
          <path className="rf-block-symbol__fill" d="M14 7v30l36-15z" />
        </>
      )
    case 'idealMixer':
      return (
        <>
          <path d="M2 22h14M48 22h14M32 38v5" />
          <circle className="rf-block-symbol__fill" cx="32" cy="22" r="16" />
          <path d="m24 14 16 16M40 14 24 30" />
        </>
      )
    case 'idealSplitter':
      return (
        <>
          <path d="M2 22h25M27 22 47 10h15M27 22l20 12h15" />
          <circle className="rf-block-symbol__junction" cx="27" cy="22" r="3" />
        </>
      )
    case 'idealCombiner':
      return (
        <>
          <path d="M2 10h15l20 12M2 34h15l20-12h25" />
          <circle className="rf-block-symbol__junction" cx="37" cy="22" r="3" />
        </>
      )
    case 'probe':
      return (
        <>
          <path d="M2 30h60M18 5l12 20" />
          <circle className="rf-block-symbol__fill" cx="32" cy="30" r="5" />
          <path d="m14 6 7-4 3 6-7 4" />
        </>
      )
    case 'load':
      return (
        <>
          <path d="M2 22h22M48 22h5v12M45 34h16M48 39h10M51 43h4" />
          <rect
            className="rf-block-symbol__fill"
            x="24"
            y="12"
            width="24"
            height="20"
            rx="2"
          />
          <path d="m29 22 4-6 5 12 5-6" />
        </>
      )
  }
}
