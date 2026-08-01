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
          <path d="M2 22h10M46 22h16" />
          <circle className="rf-block-symbol__fill" cx="29" cy="22" r="17" />
          <path d="M16 22c3.5-9 7-9 10.5 0s7 9 12.5 0" />
        </>
      )
    case 'touchstone2Port':
      return (
        <>
          <path d="M2 12h11M2 32h11M51 12h11M51 32h11" />
          <rect
            className="rf-block-symbol__fill"
            x="13"
            y="5"
            width="38"
            height="34"
            rx="4"
          />
          <circle
            className="rf-block-symbol__junction"
            cx="18"
            cy="12"
            r="1.8"
          />
          <circle
            className="rf-block-symbol__junction"
            cx="18"
            cy="32"
            r="1.8"
          />
          <circle
            className="rf-block-symbol__junction"
            cx="46"
            cy="12"
            r="1.8"
          />
          <circle
            className="rf-block-symbol__junction"
            cx="46"
            cy="32"
            r="1.8"
          />
          <path d="M21 30c5-15 10 5 14-8s7 3 9-7" />
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
          <path className="rf-block-symbol__muted" d="M20 31V13M20 31h25" />
          <path d="M22 29h5c2 0 2-13 5-13s3 13 5 13h6" />
        </>
      )
    case 'idealPhaseShifter':
      return (
        <>
          <path d="M2 22h14M48 22h14" />
          <circle className="rf-block-symbol__fill" cx="32" cy="22" r="16" />
          <path d="M23 29c2-10 5-15 9-15s7 5 9 15M25 25h14" />
          <path className="rf-block-symbol__muted" d="M32 14v11" />
        </>
      )
    case 'idealIsolator':
      return (
        <>
          <path d="M2 22h12M50 22h12M50 10v24" />
          <path className="rf-block-symbol__fill" d="M14 7v30l36-15z" />
        </>
      )
    case 'idealRFSwitch':
      return (
        <>
          <path d="M2 30h18M44 30h18M20 30 44 14" />
          <circle className="rf-block-symbol__fill" cx="20" cy="30" r="3" />
          <circle className="rf-block-symbol__fill" cx="44" cy="30" r="3" />
        </>
      )
    case 'idealDirectionalCoupler':
      return (
        <>
          <path d="M2 13h60M2 31h60" />
          <path d="M44 13c-3 9-10 16-21 18" />
          <path d="m28 26-5 5 7 1" />
          <path className="rf-block-symbol__muted" d="M20 13c3 9 10 16 21 18" />
        </>
      )
    case 'idealDiplexer':
      return (
        <>
          <path d="M2 22h20M22 22 43 10h19M22 22l21 12h19" />
          <path d="M47 7v6h11M47 37v-6h4l3 6 4-6h2" />
          <circle className="rf-block-symbol__junction" cx="22" cy="22" r="3" />
        </>
      )
    case 'transmissionLine':
      return (
        <>
          <path d="M2 22h60M14 10v24M50 10v24" />
          <path className="rf-block-symbol__muted" d="M14 15h36M14 29h36" />
          <path d="M24 7h16m-5-4 5 4-5 4" />
        </>
      )
    case 'matchingNetwork':
      return (
        <>
          <path d="M2 22h12c2-8 6-8 8 0s6 8 8 0 6-8 8 0h12M50 22h12" />
          <path d="M45 22v7M40 29h10M40 34h10M45 34v8" />
        </>
      )
    case 'idealBalun':
      return (
        <>
          <path d="M2 22h10M52 11h10M52 33h10" />
          <path d="M12 10c8 0 8 8 0 8 8 0 8 8 0 8 8 0 8 8 0 8" />
          <path d="M52 5c-8 0-8 6 0 6-8 0-8 7 0 7M52 26c-8 0-8 7 0 7-8 0-8 6 0 6" />
          <path className="rf-block-symbol__muted" d="M29 7v30M34 7v30" />
        </>
      )
    case 'vcoSource':
      return (
        <>
          <circle className="rf-block-symbol__fill" cx="29" cy="22" r="17" />
          <path d="M14 22c3-8 6-8 9 0s6 8 11 0M46 22h16M5 39 17 27M5 32v7h7" />
        </>
      )
    case 'rxAntenna':
      return (
        <>
          <path d="M34 10v32M34 15 21 3M34 15 47 3M34 28h28" />
          <path d="M5 12c8 2 13 7 16 15M11 7c9 3 15 9 18 18" />
          <path d="m16 20 5 7-8-1" />
        </>
      )
    case 'txAntenna':
      return (
        <>
          <path d="M2 28h28M30 10v32M30 15 17 3M30 15 43 3" />
          <path d="M43 27c3-8 8-13 16-15M35 25c3-9 9-15 18-18" />
          <path d="m51 13 8-1-5 7" />
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
          <path d="M2 31h60M31 31V10" />
          <path className="rf-block-symbol__fill" d="m25 18 6-9 6 9z" />
          <circle className="rf-block-symbol__junction" cx="31" cy="31" r="3" />
        </>
      )
    case 'load':
      return (
        <>
          <path d="M2 22h22l4-7 6 14 6-14 6 14 4-7h4v11" />
          <path d="M46 33h16M49 38h10M52 43h4" />
        </>
      )
  }
}
