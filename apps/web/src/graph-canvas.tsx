import { useEffect, useMemo, useState } from 'react';
import { ObjectiveIdentity } from './objective-identity';
import { objectiveCardStatus, ObjectiveHealthIcon, teamCardStyle } from './objective-visuals';
import { AlertTriangle, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { Background, Controls, MarkerType, Position, ReactFlow, useNodesState, type Edge, type Node } from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import '@xyflow/react/dist/style.css';
import type { GraphData } from './relationships';

export default function GraphCanvas({ data, onOpenObjective, storageKey }: { data: GraphData; onOpenObjective: (id: string, trigger: HTMLElement) => void; storageKey: string }) {
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
    const width = 253;
    const height = 80;
    const nodes: Node[] = shown.map(o => {
      const position = positions.get(o.id)!;
      const outsideLabel = `${o.outsideConnections} connected objective(s) outside filters`;
      const hasChildren = data.type === 'alignment' && Boolean(children.get(o.id)?.length);
      const isCollapsed = collapsed.has(o.id); const Toggle = isCollapsed ? ChevronRight : ChevronDown;
      return { id: o.id, position, sourcePosition: Position.Right, targetPosition: Position.Left, ariaLabel: `Objective ${o.title}`, className: [o.teamId ? 'graph-team' : '', o.progress >= 100 ? 'graph-goal-reached' : ''].filter(Boolean).join(' '), style: { width, height, ...teamCardStyle(o.teamId) }, data: { label: <div className="graph-node"><div className="graph-node-title"><strong title={o.title}>{o.title}</strong>{hasChildren && <button type="button" className="graph-collapse nodrag nopan" aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} children of ${o.title}`} aria-expanded={!isCollapsed} title={`${isCollapsed ? 'Expand' : 'Collapse'} children (${children.get(o.id)!.length})`} onClick={event => { event.stopPropagation(); toggleChildren(o.id); }}><Toggle size={16} aria-hidden="true"/></button>}</div><ObjectiveIdentity objective={o} compact/><div className="graph-node-status">{o.blocked && <span className="graph-blocked" role="img" aria-label="Unfinished prerequisites" title="Unfinished prerequisites"><AlertTriangle size={14} aria-hidden="true"/></span>}{o.outsideConnections > 0 && <span className="outside-connections" role="img" aria-label={outsideLabel} title={outsideLabel}><ExternalLink size={14} aria-hidden="true"/></span>}<ObjectiveHealthIcon health={o.health}/><span title={`Lifecycle: ${o.state}${o.state === 'active' && o.progress >= 100 ? '. Target achieved; complete explicitly with a closing note.' : ''}`}>{Math.round(o.progress * 10) / 10}% · {objectiveCardStatus(o)}</span></div></div> } };
    });
    const edges: Edge[] = links.map(l => ({ id: l.id, source: l.sourceId, target: l.targetId, type: 'smoothstep', ...(data.type === 'dependency' ? { markerEnd: { type: MarkerType.ArrowClosed, color: '#b17826' } } : {}), style: { stroke: data.type === 'alignment' ? '#168675' : '#b17826', strokeWidth: 2, ...(data.type === 'dependency' ? { strokeDasharray: '6 4' } : {}) } })); return { nodes, edges };
  }, [data, collapsed, positions]);
  const [nodes, setNodes, onNodesChange] = useNodesState(layout.nodes);
  useEffect(() => { setNodes(layout.nodes); }, [layout, setNodes]);
  return <>{data.type === 'alignment' && <div className="graph-view-controls"><span className="account-note">{layout.nodes.length} of {data.total} objectives visible</span>{collapsed.size > 0 && <button className="text-link" onClick={() => setCollapsed(new Set())}>Expand all children</button>}</div>}<div className="graph-canvas" onKeyDown={event => { if ((event.target as HTMLElement).closest('button') || event.key !== 'Enter' && event.key !== ' ') return; const node = (event.target as HTMLElement).closest<HTMLElement>('.react-flow__node'); if (node?.dataset.id) { event.preventDefault(); onOpenObjective(node.dataset.id, node); } }} aria-label={`${data.type === 'alignment' ? 'Alignment' : 'Prerequisite'} graph`}><ReactFlow nodes={nodes} edges={layout.edges} onNodesChange={onNodesChange} fitView fitViewOptions={{ padding: 0.18, maxZoom: 1 }} minZoom={0.1} maxZoom={2} nodesDraggable={false} nodesConnectable={false} edgesFocusable={false} deleteKeyCode={null} onNodeClick={(event, node) => onOpenObjective(node.id, event.currentTarget as HTMLElement)}><Background/><Controls showInteractive={false}/></ReactFlow></div></>;
}
