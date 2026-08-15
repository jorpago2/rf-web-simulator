import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  useNodesInitialized,
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
  idealFilter: RFBlockNode,
  idealPhaseShifter: RFBlockNode,
  idealIsolator: RFBlockNode,
  idealRFSwitch: RFBlockNode,
  idealDirectionalCoupler: RFBlockNode,
  idealDiplexer: RFBlockNode,
  transmissionLine: RFBlockNode,
  matchingNetwork: RFBlockNode,
  idealBalun: RFBlockNode,
  vcoSource: RFBlockNode,
  rxAntenna: RFBlockNode,
  txAntenna: RFBlockNode,
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
  const activeProjectId = useRFEditorStore((state) => state.activeProjectId)
  const nodes = useRFEditorStore((state) => state.nodes)
  const edges = useRFEditorStore((state) => state.edges)
  const onNodesChange = useRFEditorStore((state) => state.onNodesChange)
  const onEdgesChange = useRFEditorStore((state) => state.onEdgesChange)
  const onConnect = useRFEditorStore((state) => state.onConnect)
  const addNode = useRFEditorStore((state) => state.addNode)
  const selectedNodeId = useRFEditorStore((state) => state.selectedNodeId)
  const selectNode = useRFEditorStore((state) => state.selectNode)
  const nodesInitialized = useNodesInitialized()
  const [compactLayout, setCompactLayout] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 29.99rem)').matches)
  const canvasNodes = useMemo(() => compactLayout ? nodes.map((node, index) => {
    const row = Math.floor(index / 2)
    const column = row % 2 === 0 ? index % 2 : 1 - (index % 2)
    return { ...node, position: { x: 16 + column * 190, y: 20 + row * 124 }, draggable: false }
  }) : nodes, [compactLayout, nodes])
  const topologyKey = nodes.map((node) => node.id).join('\u0000')
  const {
    fitView,
    flowToScreenPosition,
    getNode,
    getZoom,
    screenToFlowPosition,
    setCenter,
  } = useReactFlow()

  const fitResponsiveView = useCallback(() => {
    if (!nodesInitialized) return
    const currentNodes = useRFEditorStore.getState().nodes
    if (currentNodes.length === 0) return
    const canvasWidth =
      document.querySelector<HTMLElement>('.canvas-wrap')?.clientWidth ??
      window.innerWidth
    void fitView({
      nodes: currentNodes.map(({ id }) => ({ id })),
      padding: canvasWidth < 480 ? 0.1 : 0.12,
      maxZoom: canvasWidth < 480 ? 0.9 : 1,
    })
  }, [fitView, nodesInitialized])

  useEffect(() => {
    const query = window.matchMedia('(max-width: 29.99rem)')
    const update = () => setCompactLayout(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (!nodesInitialized || nodes.length === 0) return
    const frame = window.requestAnimationFrame(fitResponsiveView)
    return () => window.cancelAnimationFrame(frame)
  }, [
    activeProjectId,
    fitResponsiveView,
    nodes.length,
    nodesInitialized,
    topologyKey,
  ])

  const ensureSelectedNodeVisible = useCallback(() => {
    if (!selectedNodeId || !nodesInitialized) return
    if (window.matchMedia('(max-width: 48rem)').matches) return

    const selectedNode = getNode(selectedNodeId)
    const canvasBounds = document
      .querySelector('.canvas-wrap')
      ?.getBoundingClientRect()
    if (!selectedNode || !canvasBounds) return

    const inspectorBounds = document
      .querySelector('.properties')
      ?.getBoundingClientRect()
    const visibleRight =
      inspectorBounds &&
      inspectorBounds.left > canvasBounds.left &&
      inspectorBounds.left < canvasBounds.right
        ? inspectorBounds.left
        : canvasBounds.right

    const width = selectedNode.measured?.width ?? 166
    const height = selectedNode.measured?.height ?? 78
    const topLeft = flowToScreenPosition(selectedNode.position)
    const bottomRight = flowToScreenPosition({
      x: selectedNode.position.x + width,
      y: selectedNode.position.y + height,
    })
    const safeInset = 16
    const isVisible =
      topLeft.x >= canvasBounds.left + safeInset &&
      topLeft.y >= canvasBounds.top + safeInset &&
      bottomRight.x <= visibleRight - safeInset &&
      bottomRight.y <= canvasBounds.bottom - safeInset

    if (!isVisible) {
      const zoom = getZoom()
      const obscuredWidth = canvasBounds.right - visibleRight
      void setCenter(
        selectedNode.position.x + width / 2 + obscuredWidth / (2 * zoom),
        selectedNode.position.y + height / 2,
        { zoom, duration: 0 },
      )
    }
  }, [
    flowToScreenPosition,
    getNode,
    getZoom,
    nodesInitialized,
    selectedNodeId,
    setCenter,
  ])

  useEffect(() => {
    const frame = window.requestAnimationFrame(ensureSelectedNodeVisible)
    return () => window.cancelAnimationFrame(frame)
  }, [ensureSelectedNodeVisible])

  useEffect(() => {
    const canvas = document.querySelector('.canvas-wrap')
    if (!canvas) return

    let frame = 0
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        if (selectedNodeId) ensureSelectedNodeVisible()
        else fitResponsiveView()
      })
    })
    observer.observe(canvas)
    return () => {
      observer.disconnect()
      window.cancelAnimationFrame(frame)
    }
  }, [ensureSelectedNodeVisible, fitResponsiveView, selectedNodeId])

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
      nodes={canvasNodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onNodeClick={(_, node) => selectNode(node.id)}
      onPaneClick={() => selectNode(null)}
      onDragOver={onDragOver}
      onDrop={onDrop}
      defaultEdgeOptions={{ type: 'straight' }}
      connectionLineStyle={{
        stroke: 'var(--rf-interactive)',
        strokeWidth: 2.5,
      }}
      deleteKeyCode={['Backspace', 'Delete']}
      minZoom={0.35}
      maxZoom={1.8}
      aria-label="RF block diagram editor"
      tabIndex={0}
    >
      <div className="visually-hidden" aria-live="polite">{compactLayout ? `Compact overview shows all ${canvasNodes.length} RF blocks in a two-column path. Node dragging is disabled; select any block to edit it.` : `${canvasNodes.length} RF blocks in the editable diagram.`}</div>
      <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}
