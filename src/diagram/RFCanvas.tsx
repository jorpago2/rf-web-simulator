import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from 'react'
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

export interface RFCanvasHandle {
  focusCanvas: () => void
  focusNode: (nodeId: string) => void
}

export const RFCanvas = forwardRef<RFCanvasHandle>(function RFCanvas(_, ref) {
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
  const [compactLayout, setCompactLayout] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(max-width: 29.99rem)').matches,
  )
  const flowElementRef = useRef<HTMLDivElement | null>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const canvasNodes = useMemo(() => {
    const accessibleNodes = nodes.map((node) => ({
      ...node,
      ariaLabel: `${node.data.label} RF block`,
    }))
    return compactLayout
      ? accessibleNodes.map((node, index) => {
          const row = Math.floor(index / 2)
          const column = row % 2 === 0 ? index % 2 : 1 - (index % 2)
          return {
            ...node,
            position: { x: 16 + column * 190, y: 20 + row * 124 },
            draggable: false,
          }
        })
      : accessibleNodes
  }, [compactLayout, nodes])
  const topologyKey = nodes.map((node) => node.id).join('\u0000')
  const { fitView, getZoom, screenToFlowPosition } = useReactFlow()

  useImperativeHandle(
    ref,
    () => ({
      focusCanvas: () => {
        flowElementRef.current?.focus({ preventScroll: true })
      },
      focusNode: (nodeId: string) => {
        const node = Array.from(
          flowElementRef.current?.querySelectorAll<HTMLElement>(
            '.react-flow__node',
          ) ?? [],
        ).find((candidate) => candidate.dataset.id === nodeId)
        if (node) {
          node.focus({ preventScroll: true })
        } else {
          flowElementRef.current?.focus({ preventScroll: true })
        }
      },
    }),
    [],
  )

  const fitResponsiveView = useCallback(() => {
    if (!nodesInitialized) return
    const currentNodes = useRFEditorStore.getState().nodes
    if (currentNodes.length === 0) return
    const canvasWidth = flowElementRef.current?.clientWidth ?? window.innerWidth
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

  const ensureSelectedNodeVisible = useCallback(() => {
    if (!selectedNodeId || !nodesInitialized) return
    if (window.matchMedia('(max-width: 48rem)').matches) return
    void fitView({
      nodes: [{ id: selectedNodeId }],
      padding: 0.5,
      maxZoom: getZoom(),
      duration: 0,
    })
  }, [fitView, getZoom, nodesInitialized, selectedNodeId])

  useEffect(() => {
    const canvas = flowElementRef.current
    if (!canvas) return

    const updateCanvasSize = () => {
      const { width, height } = canvas.getBoundingClientRect()
      setCanvasSize((current) =>
        Math.abs(current.width - width) < 0.5 &&
        Math.abs(current.height - height) < 0.5
          ? current
          : { width, height },
      )
    }
    const observer = new ResizeObserver(updateCanvasSize)
    updateCanvasSize()
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!nodesInitialized || nodes.length === 0 || canvasSize.width === 0) {
      return
    }
    const frame = window.requestAnimationFrame(() => {
      if (selectedNodeId) ensureSelectedNodeVisible()
      else fitResponsiveView()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [
    activeProjectId,
    canvasSize,
    ensureSelectedNodeVisible,
    fitResponsiveView,
    nodes.length,
    nodesInitialized,
    selectedNodeId,
    topologyKey,
  ])

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
      ref={flowElementRef}
      defaultEdgeOptions={{ type: 'straight' }}
      connectionLineStyle={{
        stroke: 'var(--rf-interactive)',
        strokeWidth: 2.5,
      }}
      deleteKeyCode={['Backspace', 'Delete']}
      minZoom={0.2}
      maxZoom={1.8}
      aria-label="RF block diagram editor"
      tabIndex={0}
    >
      <div className="scientific-visually-hidden" aria-live="polite">
        {compactLayout
          ? `Compact overview shows all ${canvasNodes.length} RF blocks in a two-column path. Node dragging is disabled; select any block to edit it.`
          : `${canvasNodes.length} RF blocks in the editable diagram.`}
      </div>
      <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
})
