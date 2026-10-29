import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ObjectiveIdentity } from './objective-identity';
import { objectiveCardStatus, ObjectiveHealthIcon, teamCardStyle } from './objective-visuals';
import { AlertTriangle, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, useNodesState, type Edge, type Node, type NodeProps, type OnNodesChange, type XYPosition } from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import '@xyflow/react/dist/style.css';
import type { GraphData } from './relationships';
import { editableGraphObjective as editable, useGraphEditor } from './graph-editor';
import { CARD_HEIGHT, CARD_WIDTH, separateCard } from './graph-spacing';

type ObjectiveNode = Node<{ label: ReactNode; sourceConnectable: boolean; targetConnectable: boolean; targetStart: boolean }, 'objective'>;
function GraphObjective({ data }: NodeProps<ObjectiveNode>) {
  return <><Handle type="target" position={Position.Left} isConnectable={data.targetConnectable} isConnectableStart={data.targetStart} title={data.targetStart ? 'Drag to connect a parent or prerequisite' : 'Parent or prerequisite connection point'}/>{data.label}<Handle type="source" position={Position.Right} isConnectable={data.sourceConnectable} title={data.sourceConnectable ? 'Drag to connect a child or dependent' : 'Child or dependent connection point'}/></>;
}
const nodeTypes = { objective: GraphObjective };

export default function GraphCanvas({ data, onOpenObjective, storageKey }: { data: GraphData; onOpenObjective: (id: string, trigger: HTMLElement) => void; storageKey: string }) {
  const canvas = useRef<HTMLDivElement>(null);
  const { action, selectedEdge, canCreate, canManage, canReconnect, chooseEdge, requestRemoval, validConnection, onConnect, onConnectStart, onReconnect, onReconnectStart, toolbar, lockNotice, editor } = useGraphEditor(data, canvas, onOpenObjective);
  const positionStorageKey = `${storageKey}.positions.${data.type}`;
  const [manualPositions, setManualPositions] = useState<Record<string, XYPosition>>(() => {
    try {
      const saved: unknown = JSON.parse(sessionStorage.getItem(positionStorageKey) || '{}');
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
      return Object.fromEntries(Object.entries(saved).filter((entry): entry is [string, XYPosition] => {
        const p = entry[1]; return Boolean(p && typeof p === 'object' && Number.isFinite(p.x) && Number.isFinite(p.y));
      }));
    } catch { return {}; }
  });
  useEffect(() => { try { sessionStorage.setItem(positionStorageKey, JSON.stringify(manualPositions)); } catch { /* Moving cards still works without browser storage. */ } }, [manualPositions, positionStorageKey]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try { const ids: unknown = JSON.parse(sessionStorage.getItem(storageKey) || '[]'); return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []); } catch { return new Set(); }
  });
  useEffect(() => { try { sessionStorage.setItem(storageKey, JSON.stringify([...collapsed])); } catch { /* Collapsing works without browser storage. */ } }, [collapsed, storageKey]);
  const toggleChildren = (id: string) => setCollapsed(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const positions = useMemo(() => {
    const graph = new dagre.graphlib.Graph(); graph.setGraph({ rankdir: 'LR', nodesep: 35, ranksep: 70 }); graph.setDefaultEdgeLabel(() => ({}));
    data.nodes.forEach(o => graph.setNode(o.id, { width: 253, height: 80 }));
    data.links.forEach(l => graph.setEdge(l.sourceId, l.targetId)); dagre.layout(graph);
    return new Map(data.nodes.map(o => { const p = graph.node(o.id); return [o.id, { x: p.x - 253 / 2, y: p.y - 80 / 2 }]; }));
  }, [data]);
  const spacedPositions = useMemo(() => {
    const placed = new Map<string, XYPosition>();
    // Keep the automatic tree intact, then restore personal positions in stable order.
    const ordered = [...data.nodes].sort((a, b) => Number(Boolean(manualPositions[a.id])) - Number(Boolean(manualPositions[b.id])) || a.id.localeCompare(b.id));
    for (const objective of ordered) {
      placed.set(objective.id, separateCard(manualPositions[objective.id] || positions.get(objective.id)!, [...placed.values()]));
    }
    return placed;
  }, [data.nodes, positions, manualPositions]);
  useEffect(() => {
    setManualPositions(previous => {
      const corrected = Object.entries(previous).filter(([id, p]) => {
        const next = spacedPositions.get(id); return next && (next.x !== p.x || next.y !== p.y);
      });
      return corrected.length ? { ...previous, ...Object.fromEntries(corrected.map(([id]) => [id, spacedPositions.get(id)!])) } : previous;
    });
  }, [spacedPositions]);
  const layout = useMemo(() => {
    const children = new Map<string, string[]>(); const incoming = new Set<string>();
    for (const link of data.links) { children.set(link.sourceId, [...(children.get(link.sourceId) || []), link.targetId]); incoming.add(link.targetId); }
    const visible = new Set<string>();
    const pending = data.nodes.filter(o => !incoming.has(o.id)).map(o => o.id);
    while (pending.length) {
      const id = pending.pop()!; if (visible.has(id)) continue; visible.add(id);
      if (data.type !== 'alignment' || !collapsed.has(id)) pending.push(...(children.get(id) || []));
    }
    const shown = data.nodes.filter(o => visible.has(o.id));
    const links = data.links.filter(l => visible.has(l.sourceId) && visible.has(l.targetId) && (data.type !== 'alignment' || !collapsed.has(l.sourceId)));
    const width = CARD_WIDTH;
    const height = CARD_HEIGHT;
    const nodes: ObjectiveNode[] = shown.map(o => {
      const position = spacedPositions.get(o.id)!;
      const outsideLabel = `${o.outsideConnections} connected objective(s) outside filters`;
      const hasChildren = data.type === 'alignment' && Boolean(children.get(o.id)?.length);
      const isCollapsed = collapsed.has(o.id); const Toggle = isCollapsed ? ChevronRight : ChevronDown;
      return { id: o.id, type: 'objective', position, sourcePosition: Position.Right, targetPosition: Position.Left, ariaLabel: `Objective ${o.title}`, className: ['react-flow__node-default', o.teamId ? 'graph-team' : '', o.progress >= 100 ? 'graph-goal-reached' : ''].filter(Boolean).join(' '), style: { width, height, ...teamCardStyle(o.teamId) }, data: {
        sourceConnectable: !action.pending && (data.type === 'alignment' ? editable(o) : canCreate), targetConnectable: !action.pending && editable(o), targetStart: !action.pending && editable(o) && (data.type !== 'alignment' || !o.alignmentParentCount),
        label: <div className="graph-node"><div className="graph-node-title"><strong title={o.title}>{o.title}</strong>{hasChildren && <button type="button" className="graph-collapse nodrag nopan" aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} children of ${o.title}`} aria-expanded={!isCollapsed} title={`${isCollapsed ? 'Expand' : 'Collapse'} children (${children.get(o.id)!.length})`} onClick={event => { event.stopPropagation(); toggleChildren(o.id); }}><Toggle size={16} aria-hidden="true"/></button>}</div><ObjectiveIdentity objective={o} compact/><div className="graph-node-status">{o.blocked && <span className="graph-blocked" role="img" aria-label="Unfinished prerequisites" title="Unfinished prerequisites"><AlertTriangle size={14} aria-hidden="true"/></span>}{o.outsideConnections > 0 && <span className="outside-connections" role="img" aria-label={outsideLabel} title={outsideLabel}><ExternalLink size={14} aria-hidden="true"/></span>}<ObjectiveHealthIcon health={o.health}/><span title={`Lifecycle: ${o.state}${o.state === 'active' && o.progress >= 100 ? '. Target achieved; complete explicitly with a closing note.' : ''}`}>{Math.round(o.progress * 10) / 10}% · {objectiveCardStatus(o)}</span></div></div> } };
    });
    const edges: Edge[] = links.map(l => ({ id: l.id, source: l.sourceId, target: l.targetId, type: 'smoothstep', reconnectable: canReconnect(l) && selectedEdge === l.id && !action.pending, focusable: true, selected: selectedEdge === l.id, ariaLabel: `${data.type === 'alignment' ? 'Alignment' : 'Prerequisite'}: ${data.nodes.find(o => o.id === l.sourceId)?.title} to ${data.nodes.find(o => o.id === l.targetId)?.title}`, ...(data.type === 'dependency' ? { markerEnd: { type: MarkerType.ArrowClosed, color: '#b17826' } } : {}), style: { stroke: data.type === 'alignment' ? '#168675' : '#b17826', strokeWidth: selectedEdge === l.id ? 3 : 2, ...(data.type === 'dependency' ? { strokeDasharray: '6 4' } : {}) } })); return { nodes, edges };
  }, [data, collapsed, spacedPositions, action.pending, selectedEdge, canReconnect, canManage, canCreate]);
  const [nodes, setNodes, changeNodes] = useNodesState(layout.nodes);
  const onNodesChange = useCallback<OnNodesChange<ObjectiveNode>>(changes => {
    changeNodes(changes);
    const moved = changes.flatMap(change => change.type === 'position' && change.position && change.dragging !== true ? [[change.id, change.position] as const] : []);
    if (moved.length) {
      const occupied = new Map(spacedPositions);
      moved.forEach(([id]) => occupied.delete(id));
      const corrected = moved.map(([id, position]) => {
        const free = separateCard(position, [...occupied.values()]); occupied.set(id, free); return [id, free];
      });
      setManualPositions(previous => ({ ...previous, ...Object.fromEntries(corrected) }));
    }
  }, [changeNodes, spacedPositions]);
  useEffect(() => { setNodes(layout.nodes); }, [layout, setNodes]);
  return <><div className="graph-view-controls"><span className="account-note">{layout.nodes.length} of {data.total} objectives visible</span>{data.type === 'alignment' && collapsed.size > 0 && <button className="text-link" onClick={() => setCollapsed(new Set())}>Expand all children</button>}{Object.keys(manualPositions).length > 0 && <button className="text-link" onClick={() => setManualPositions({})}>Reset card positions</button>}{toolbar}</div><p className="account-note">Drag cards; overlaps adjust. Drag side points to connect. Select a line and press Delete to remove it.</p>
    <div ref={canvas} tabIndex={-1} role="region" className="graph-canvas graph-reconnectable" aria-busy={action.pending} onKeyDown={event => {
      const target = event.target as Element; if (target.closest('button, input, textarea, select, [contenteditable="true"]')) return;
      const element = target.closest<HTMLElement>('.react-flow__node, .react-flow__edge');
      if (event.key === 'Delete') {
        if (!event.repeat && !element?.classList.contains('react-flow__node') && requestRemoval(element?.dataset.id || selectedEdge)) event.preventDefault();
        return;
      }
      if (event.key !== 'Enter' && event.key !== ' ' || !element?.dataset.id) return;
      event.preventDefault(); if (element.classList.contains('react-flow__edge')) chooseEdge(element.dataset.id); else onOpenObjective(element.dataset.id, element);
    }} aria-label={`${data.type === 'alignment' ? 'Alignment' : 'Prerequisite'} graph`}>{lockNotice}<ReactFlow nodes={nodes} nodeTypes={nodeTypes} edges={layout.edges} onNodesChange={onNodesChange} fitView fitViewOptions={{ padding: 0.18, maxZoom: 1 }} minZoom={0.1} maxZoom={2} nodesDraggable nodeDragThreshold={4} edgesReconnectable={!action.pending && data.type === 'alignment'} elevateEdgesOnSelect reconnectRadius={14} edgesFocusable deleteKeyCode={null} onConnect={onConnect} onConnectStart={onConnectStart} onReconnect={onReconnect} onReconnectStart={onReconnectStart} isValidConnection={validConnection} onEdgeClick={(_event, edge) => { chooseEdge(edge.id); canvas.current?.focus({ preventScroll: true }); }} onNodeClick={(event, node) => { if (!(event.target as Element).closest('.react-flow__handle')) onOpenObjective(node.id, event.currentTarget as HTMLElement); }}><Background/><Controls showInteractive={false}/></ReactFlow></div>{editor}</>;
}
