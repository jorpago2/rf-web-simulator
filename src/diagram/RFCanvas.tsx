import { useCallback, type DragEvent } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type NodeTypes,
} from '@xyflow/react'
import { useRFEditorStore } from '../app/store'
import type { RFNodeType } from '../engine/types'
import { RFBlockNode } from './nodes/RFBlockNode'

const nodeTypes: NodeTypes = {
  source: RFBlockNode,
  touchstone2Port: RFBlockNode,
  idealAmplifier: RFBlockNode,
  idealAttenuator: RFBlockNode,
  idealMixer: RFBlockNode,
  idealSplitter: RFBlockNode,
  idealCombiner: RFBlockNode,
  load: RFBlockNode,
  probe: RFBlockNode,
}

function isRFNodeType(value: string): value is RFNodeType {
  return value in nodeTypes
}

export function RFCanvas() {
  const nodes = useRFEditorStore((state) => state.nodes)
  const edges = useRFEditorStore((state) => state.edges)
  const onNodesChange = useRFEditorStore((state) => state.onNodesChange)
  const onEdgesChange = useRFEditorStore((state) => state.onEdgesChange)
  const onConnect = useRFEditorStore((state) => state.onConnect)
  const addNode = useRFEditorStore((state) => state.addNode)
  const selectNode = useRFEditorStore((state) => state.selectNode)
  const { screenToFlowPosition } = useReactFlow()

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault()
      const type = event.dataTransfer.getData('application/rf-node-type')
      if (!isRFNodeType(type)) return
      addNode(
        type,
        screenToFlowPosition({ x: event.clientX, y: event.clientY }),
      )
    },
    [addNode, screenToFlowPosition],
  )

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onNodeClick={(_, node) => selectNode(node.id)}
      onPaneClick={() => selectNode(null)}
      onDragOver={onDragOver}
      onDrop={onDrop}
      deleteKeyCode={['Backspace', 'Delete']}
      fitView
      fitViewOptions={{ padding: 0.22 }}
      minZoom={0.35}
      maxZoom={1.8}
      aria-label="RF block diagram editor"
    >
      <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
      <MiniMap pannable zoomable aria-label="Diagram overview" />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}
