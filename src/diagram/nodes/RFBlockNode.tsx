import { Handle, Position, type NodeProps } from '@xyflow/react'
import { getBlockDescriptor } from '../nodeRegistry'
import { RFBlockSymbol } from '../RFBlockSymbol'
import type { RFCanvasNode } from '../../app/store'
import { portsForData } from '../../engine/ports'

export function RFBlockNode({ data, selected }: NodeProps<RFCanvasNode>) {
  const descriptor = getBlockDescriptor(data.type)
  const ports = portsForData(data)
  const inputs = ports.filter((port) => port.role === 'input')
  const outputs = ports.filter((port) => port.role === 'output')

  return (
    <div
      className={`rf-node${selected ? ' is-selected' : ''}`}
      style={{ '--node-accent': descriptor.accent } as React.CSSProperties}
      role="group"
      aria-label={`${data.label} RF block`}
      title={`${data.label}\n${descriptor.description}`}
    >
      {inputs.map((port, index) => (
        <Handle
          key={port.id}
          type="target"
          position={Position.Left}
          id={port.id}
          title={port.label}
          style={{ top: `${((index + 1) * 100) / (inputs.length + 1)}%` }}
        />
      ))}
      <span className="rf-node__symbol">
        <RFBlockSymbol type={data.type} />
      </span>
      <span className="rf-node__label">{data.label}</span>
      <span className="rf-node__description">{descriptor.description}</span>
      {outputs.map((port, index) => (
        <Handle
          key={port.id}
          type="source"
          position={Position.Right}
          id={port.id}
          title={port.label}
          style={{ top: `${((index + 1) * 100) / (outputs.length + 1)}%` }}
        />
      ))}
    </div>
  )
}
