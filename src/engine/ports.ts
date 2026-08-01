import type { RFNodeData, RFNodeType, RFProjectNode } from './types'

export interface RFPortDescriptor {
  id: string
  label: string
  role: 'input' | 'output'
}

const PORTS: Record<RFNodeType, readonly RFPortDescriptor[]> = {
  source: [{ id: 'output', label: 'OUT', role: 'output' }],
  load: [{ id: 'input', label: 'IN', role: 'input' }],
  touchstone2Port: [
    { id: 'input', label: '1', role: 'input' },
    { id: 'output', label: '2', role: 'output' },
  ],
  idealAmplifier: [
    { id: 'input', label: 'IN', role: 'input' },
    { id: 'output', label: 'OUT', role: 'output' },
  ],
  idealAttenuator: [
    { id: 'input', label: 'IN', role: 'input' },
    { id: 'output', label: 'OUT', role: 'output' },
  ],
  idealFilter: [
    { id: 'input', label: 'IN', role: 'input' },
    { id: 'output', label: 'OUT', role: 'output' },
  ],
  idealPhaseShifter: [
    { id: 'input', label: 'IN', role: 'input' },
    { id: 'output', label: 'OUT', role: 'output' },
  ],
  idealIsolator: [
    { id: 'input', label: 'IN', role: 'input' },
    { id: 'output', label: 'OUT', role: 'output' },
  ],
  idealRFSwitch: [
    { id: 'input', label: 'IN', role: 'input' },
    { id: 'output', label: 'OUT', role: 'output' },
  ],
  idealDirectionalCoupler: [
    { id: 'input', label: 'IN', role: 'input' },
    { id: 'through', label: 'THRU', role: 'output' },
    { id: 'coupled', label: 'CPL', role: 'output' },
  ],
  idealDiplexer: [
    { id: 'common', label: 'COM', role: 'input' },
    { id: 'low', label: 'LOW', role: 'output' },
    { id: 'high', label: 'HIGH', role: 'output' },
  ],
  transmissionLine: [
    { id: 'input', label: 'IN', role: 'input' },
    { id: 'output', label: 'OUT', role: 'output' },
  ],
  matchingNetwork: [
    { id: 'input', label: 'IN', role: 'input' },
    { id: 'output', label: 'OUT', role: 'output' },
  ],
  idealBalun: [
    { id: 'input', label: 'UNBAL', role: 'input' },
    { id: 'positive', label: 'P', role: 'output' },
    { id: 'negative', label: 'N', role: 'output' },
  ],
  vcoSource: [{ id: 'output', label: 'RF', role: 'output' }],
  rxAntenna: [{ id: 'output', label: 'RX', role: 'output' }],
  txAntenna: [{ id: 'input', label: 'TX', role: 'input' }],
  idealMixer: [
    { id: 'input', label: 'RF', role: 'input' },
    { id: 'output', label: 'IF', role: 'output' },
  ],
  probe: [
    { id: 'input', label: 'IN', role: 'input' },
    { id: 'output', label: 'OUT', role: 'output' },
  ],
  idealSplitter: [
    { id: 'input', label: 'IN', role: 'input' },
    { id: 'output-1', label: 'A', role: 'output' },
    { id: 'output-2', label: 'B', role: 'output' },
  ],
  idealCombiner: [
    { id: 'input-1', label: 'A', role: 'input' },
    { id: 'input-2', label: 'B', role: 'input' },
    { id: 'output', label: 'OUT', role: 'output' },
  ],
}

export function portsForNode(node: RFProjectNode): readonly RFPortDescriptor[] {
  return portsForData(node.data)
}

export function portsForData(data: RFNodeData): readonly RFPortDescriptor[] {
  if (data.type !== 'touchstone2Port') return portsForType(data.type)
  const portCount = data.parameters.portCount
  if (!Number.isInteger(portCount) || (portCount as number) < 1) {
    return PORTS.touchstone2Port
  }
  if (portCount === 2) return PORTS.touchstone2Port
  const roles = Array.isArray(data.parameters.portRoles)
    ? data.parameters.portRoles
    : []
  return Array.from({ length: portCount as number }, (_, index) => ({
    id: `port-${index + 1}`,
    label: String(index + 1),
    role:
      roles[index] === 'output' ? 'output' : index === 0 ? 'input' : 'output',
  }))
}

export function portsForType(type: RFNodeType): readonly RFPortDescriptor[] {
  return PORTS[type]
}

export function isSourceTerminal(node: RFProjectNode): boolean {
  return ['source', 'vcoSource', 'rxAntenna'].includes(node.data.type)
}

export function isLoadTerminal(node: RFProjectNode): boolean {
  return ['load', 'txAntenna'].includes(node.data.type)
}

export function resolveEdgePort(
  node: RFProjectNode,
  role: 'input' | 'output',
  requestedHandle: string | undefined,
): RFPortDescriptor | undefined {
  const ports = portsForNode(node).filter((port) => port.role === role)
  if (requestedHandle) return ports.find((port) => port.id === requestedHandle)
  return ports.length === 1 ? ports[0] : undefined
}
