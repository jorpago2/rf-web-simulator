import { Handle, Position, type NodeProps } from '@xyflow/react'
import { getBlockDescriptor } from '../nodeRegistry'
import type { RFCanvasNode } from '../../app/store'

export function RFBlockNode({ data, selected }: NodeProps<RFCanvasNode>) {
  const descriptor = getBlockDescriptor(data.type)
  const hasInput = data.type !== 'source'
  const hasOutput = data.type !== 'load'

  return (
    <div
      className={`rf-node${selected ? ' is-selected' : ''}`}
      style={{ '--node-accent': descriptor.accent } as React.CSSProperties}
      role="group"
      aria-label={`${data.label} RF block`}
    >
      {hasInput && <Handle type="target" position={Position.Left} id="input" />}
      <span className="rf-node__symbol">{descriptor.symbol}</span>
      <span className="rf-node__label">{data.label}</span>
      <span className="rf-node__description">{descriptor.description}</span>
      {hasOutput && (
        <Handle type="source" position={Position.Right} id="output" />
      )}
    </div>
  )
}
