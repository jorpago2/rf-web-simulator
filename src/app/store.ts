import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type XYPosition,
} from '@xyflow/react'
import { create } from 'zustand'
import { createNodeData } from '../diagram/nodeRegistry'
import type { RFNodeData, RFNodeType } from '../engine/types'

export type RFCanvasNode = Node<RFNodeData, RFNodeType>
export type RFCanvasEdge = Edge

const initialNodes: RFCanvasNode[] = [
  {
    id: 'source-1',
    type: 'source',
    position: { x: 80, y: 130 },
    data: createNodeData('source'),
  },
  {
    id: 'amplifier-1',
    type: 'idealAmplifier',
    position: { x: 340, y: 130 },
    data: createNodeData('idealAmplifier'),
  },
  {
    id: 'load-1',
    type: 'load',
    position: { x: 610, y: 130 },
    data: createNodeData('load'),
  },
]

const initialEdges: RFCanvasEdge[] = [
  { id: 'edge-source-amplifier', source: 'source-1', target: 'amplifier-1' },
  { id: 'edge-amplifier-load', source: 'amplifier-1', target: 'load-1' },
]

interface RFEditorState {
  nodes: RFCanvasNode[]
  edges: RFCanvasEdge[]
  selectedNodeId: string | null
  onNodesChange: (changes: NodeChange<RFCanvasNode>[]) => void
  onEdgesChange: (changes: EdgeChange<RFCanvasEdge>[]) => void
  onConnect: (connection: Connection) => void
  addNode: (type: RFNodeType, position?: XYPosition) => void
  selectNode: (id: string | null) => void
  updateNodeLabel: (id: string, label: string) => void
  updateNodeParameters: (
    id: string,
    parameters: Record<string, unknown>,
  ) => void
  removeSelectedNode: () => void
}

export const useRFEditorStore = create<RFEditorState>((set, get) => ({
  nodes: initialNodes,
  edges: initialEdges,
  selectedNodeId: null,
  onNodesChange: (changes) =>
    set((state) => ({ nodes: applyNodeChanges(changes, state.nodes) })),
  onEdgesChange: (changes) =>
    set((state) => ({ edges: applyEdgeChanges(changes, state.edges) })),
  onConnect: (connection) =>
    set((state) => ({
      edges: addEdge(
        { ...connection, id: crypto.randomUUID(), animated: true },
        state.edges,
      ),
    })),
  addNode: (type, position) =>
    set((state) => ({
      nodes: [
        ...state.nodes,
        {
          id: crypto.randomUUID(),
          type,
          position: position ?? {
            x: 140 + (state.nodes.length % 4) * 170,
            y: 80 + Math.floor(state.nodes.length / 4) * 130,
          },
          data: createNodeData(type),
        },
      ],
    })),
  selectNode: (id) => set({ selectedNodeId: id }),
  updateNodeLabel: (id, label) =>
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === id ? { ...node, data: { ...node.data, label } } : node,
      ),
    })),
  updateNodeParameters: (id, parameters) =>
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === id
          ? {
              ...node,
              data: {
                ...node.data,
                parameters: { ...node.data.parameters, ...parameters },
              },
            }
          : node,
      ),
    })),
  removeSelectedNode: () => {
    const selectedNodeId = get().selectedNodeId
    if (!selectedNodeId) return
    set((state) => ({
      nodes: state.nodes.filter((node) => node.id !== selectedNodeId),
      edges: state.edges.filter(
        (edge) =>
          edge.source !== selectedNodeId && edge.target !== selectedNodeId,
      ),
      selectedNodeId: null,
    }))
  },
}))
