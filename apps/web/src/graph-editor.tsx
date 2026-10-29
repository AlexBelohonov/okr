import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { Connection, Edge, OnConnectStart } from '@xyflow/react';
import type { GraphData } from './relationships';
import { Feedback, useAction, useOrganization } from './organizations';

export const editableGraphObjective = (o: GraphData['nodes'][number] | undefined) => Boolean(o?.canEdit && !o.archivedAt && ['active', 'draft'].includes(o.state));
type Link = GraphData['links'][number];
type Removal = { id: string; sourceVersion: number; targetVersion: number };

export function useGraphEditor(data: GraphData, canvas: RefObject<HTMLDivElement | null>, onOpenObjective: (id: string, trigger: HTMLElement) => void) {
  const { send, reload } = useOrganization(); const action = useAction(); const saving = useRef(false); const focusGraph = useRef(false);
  const [selectedEdge, selectEdge] = useState<string | null>(null); const [end, setEnd] = useState<'parent' | 'child'>('parent'); const [replacementId, setReplacementId] = useState('');
  const [removal, setRemoval] = useState<Removal | null>(null); const [creating, setCreating] = useState(false); const [sourceId, setSourceId] = useState(''); const [targetId, setTargetId] = useState('');
  const drag = useRef<{ id: string | null; data: GraphData } | null>(null);
  const confirmRemoval = useRef<HTMLButtonElement>(null);
  const alignment = data.type === 'alignment';
  const node = (id: string) => data.nodes.find(o => o.id === id);
  const currentLink = data.links.find(l => l.id === selectedEdge);
  const canManage = useCallback((link: Link) => editableGraphObjective(data.nodes.find(o => o.id === link.targetId)) && (data.type === 'dependency' || editableGraphObjective(data.nodes.find(o => o.id === link.sourceId))), [data]);
  const canReconnect = useCallback((link: Link) => data.type === 'alignment' && canManage(link), [data.type, canManage]);
  const canCreate = data.nodes.some(editableGraphObjective);
  const chooseEdge = useCallback((id: string) => { selectEdge(id); setReplacementId(''); setRemoval(null); setCreating(false); }, []);
  const closeEditor = () => { focusGraph.current = true; selectEdge(null); setCreating(false); setRemoval(null); };
  useEffect(() => {
    if (action.pending || !focusGraph.current) return;
    const frame = requestAnimationFrame(() => { canvas.current?.focus({ preventScroll: true }); focusGraph.current = false; });
    return () => cancelAnimationFrame(frame);
  }, [action.pending, selectedEdge, creating, removal, canvas]);
  useEffect(() => { if (removal) confirmRemoval.current?.focus(); }, [removal]);

  const commit = useCallback((work: () => Promise<void>, message: string) => {
    if (saving.current) return;
    saving.current = true;
    void action.run(async () => {
      try {
        await work(); await reload(); focusGraph.current = true; selectEdge(null); setCreating(false); setRemoval(null); setReplacementId(''); setSourceId(''); setTargetId(''); return message;
      } finally { saving.current = false; }
    });
  }, [send, reload, action.run]);
  const reattach = useCallback((id: string, moving: 'parent' | 'child', objectiveId: string, snapshot: GraphData) => {
    const link = snapshot.links.find(l => l.id === id); if (!link) return;
    const source = snapshot.nodes.find(o => o.id === link.sourceId); const target = snapshot.nodes.find(o => o.id === link.targetId); const replacement = snapshot.nodes.find(o => o.id === objectiveId);
    if (!source || !target || !replacement || objectiveId === (moving === 'parent' ? source.id : target.id)) return;
    commit(async () => { await send(`links/${id}/reconnect`, { sourceVersion: source.version, targetVersion: target.version, end: moving, objectiveId, objectiveVersion: replacement.version }); }, `Alignment ${moving} changed to ${replacement.title}`);
  }, [send, commit]);
  const createLine = useCallback((connection: Pick<Connection, 'source' | 'target'>, snapshot: GraphData) => {
    const source = snapshot.nodes.find(o => o.id === connection.source); const target = snapshot.nodes.find(o => o.id === connection.target); if (!source || !target) return;
    commit(async () => { await send('links', { sourceId: source.id, targetId: target.id, sourceVersion: source.version, targetVersion: target.version, type: snapshot.type, weight: 1 }); }, snapshot.type === 'alignment' ? 'Alignment line created' : 'Dependency line created');
  }, [send, commit]);
  const onConnectStart = useCallback<OnConnectStart>((event) => {
    // React Flow also fires this callback while reconnecting an existing edge.
    // Keep its identity so the current parent is excluded from validation.
    if (!(event?.target instanceof Element) || !event.target.closest('.react-flow__edgeupdater')) drag.current = { id: null, data };
  }, [data]);
  const onReconnectStart = useCallback((_event: unknown, edge: Edge) => { drag.current = { id: edge.id, data }; }, [data]);
  const onConnect = useCallback((connection: Connection) => createLine(connection, drag.current?.data || data), [createLine, data]);
  const onReconnect = useCallback((edge: Edge, connection: Connection) => {
    const snapshot = drag.current?.id === edge.id ? drag.current.data : data;
    if (connection.source !== edge.source && connection.target === edge.target) reattach(edge.id, 'parent', connection.source, snapshot);
    else if (connection.target !== edge.target && connection.source === edge.source) reattach(edge.id, 'child', connection.target, snapshot);
  }, [data, reattach]);
  const validConnection = useCallback((connection: Connection | Edge) => {
    const source = data.nodes.find(o => o.id === connection.source); const target = data.nodes.find(o => o.id === connection.target);
    if (!source || !target || source.id === target.id || !editableGraphObjective(target) || data.type === 'alignment' && !editableGraphObjective(source)) return false;
    const original = data.links.find(l => l.id === drag.current?.id);
    if (data.type === 'alignment' && target.alignmentParentCount > (original?.targetId === target.id ? 1 : 0)) return false;
    return !data.links.some(l => l.id !== original?.id && l.sourceId === source.id && l.targetId === target.id);
  }, [data]);
  const eligibleReplacement = (id: string) => {
    const o = node(id); if (!currentLink || !editableGraphObjective(o) || id === currentLink.sourceId || id === currentLink.targetId || end === 'child' && o!.alignmentParentCount > 0) return false;
    return !data.links.some(l => l.id !== currentLink.id && l.sourceId === (end === 'parent' ? id : currentLink.sourceId) && l.targetId === (end === 'child' ? id : currentLink.targetId));
  };
  const requestRemoval = (id: string | null = selectedEdge) => {
    const link = data.links.find(l => l.id === id);
    if (!link || !canManage(link) || action.pending || removal) return false;
    selectEdge(link.id); setCreating(false);
    setRemoval({ id: link.id, sourceVersion: node(link.sourceId)!.version, targetVersion: node(link.targetId)!.version });
    return true;
  };
  const canUseSource = (id: string) => Boolean(node(id) && (alignment ? editableGraphObjective(node(id)) : canCreate));
  const canUseTarget = (id: string) => editableGraphObjective(node(id)) && (!alignment || !node(id)!.alignmentParentCount);
  const toolbar = canCreate && <button className="text-link" disabled={action.pending} onClick={() => { selectEdge(null); setRemoval(null); setCreating(!creating); }}>{creating ? 'Cancel new connection' : 'Connect objectives'}</button>;
  const blockedObjectives = currentLink ? [node(currentLink.targetId), ...(alignment ? [node(currentLink.sourceId)] : [])].filter((o): o is GraphData['nodes'][number] => Boolean(o && !editableGraphObjective(o))) : [];
  const lockReason = (o: GraphData['nodes'][number]) => {
    if (!o.canEdit) return 'You do not have edit access. Ask its owner or an organization administrator to change this line.';
    const closed = !['active', 'draft'].includes(o.state);
    if (o.archivedAt) return `This objective is archived${closed ? ` and ${o.state}` : ''}. Unarchive${closed ? ' and reopen' : ''} it before changing this line.`;
    return `This objective is ${o.state}. Reopen it before changing this line.`;
  };
  const lockNotice = blockedObjectives.length > 0 && <section className="graph-lock-notice" aria-label="Unavailable relationship">
      <p role="status">This line cannot be changed:</p>
      {blockedObjectives.map(o => <div key={o.id}><p><strong>{o.title}</strong> — {lockReason(o)}</p><button className="secondary-button" aria-label={`Open objective ${o.title}`} onClick={event => onOpenObjective(o.id, event.currentTarget)}>Open objective</button></div>)}
      <button className="text-link" onClick={closeEditor}>Close line details</button>
    </section>;
  const editor = <>
    <Feedback {...action}/>{action.error && <button className="secondary-button" disabled={action.pending} onClick={() => { void reload(); setReplacementId(''); setRemoval(null); setSourceId(''); setTargetId(''); }}>Reload alignment</button>}
    {creating && <section className="graph-reattach" aria-label="New graph connection"><form className="account-form" onSubmit={event => { event.preventDefault(); createLine({ source: sourceId, target: targetId }, data); }}>
      <label className="form-field"><span>{alignment ? 'Parent objective' : 'Prerequisite objective'}</span><select value={sourceId} disabled={action.pending} onChange={event => setSourceId(event.target.value)}><option value="">Choose an objective</option>{data.nodes.filter(o => canUseSource(o.id) && o.id !== targetId).map(o => <option key={o.id} value={o.id}>{o.title}</option>)}</select></label>
      <label className="form-field"><span>{alignment ? 'Child objective' : 'Dependent objective'}</span><select value={targetId} disabled={action.pending} onChange={event => setTargetId(event.target.value)}><option value="">Choose an objective</option>{data.nodes.filter(o => canUseTarget(o.id) && o.id !== sourceId && !data.links.some(l => l.sourceId === sourceId && l.targetId === o.id)).map(o => <option key={o.id} value={o.id}>{o.title}</option>)}</select></label>
      <p className="account-note">Choose from objectives matching the filters. Each objective can have one alignment parent. New alignment weights start at 1.</p>
      <div className="heading-actions"><button className="primary-button" disabled={!sourceId || !targetId || action.pending}>Create line</button><button type="button" className="secondary-button" disabled={action.pending} onClick={closeEditor}>Cancel connection</button></div>
    </form></section>}
    {currentLink && canManage(currentLink) && <section className="graph-reattach" aria-label={alignment ? 'Reattach alignment' : 'Dependency line'}>
      <p><strong>{node(currentLink.sourceId)?.title}</strong> → <strong>{node(currentLink.targetId)?.title}</strong>{alignment && ` · Weight ${currentLink.weight}`}</p>
      {alignment && !removal && <form className="account-form" onSubmit={event => { event.preventDefault(); reattach(currentLink.id, end, replacementId, data); }}>
        <p className="account-note">Drag the left end to another parent's right connection point, or the right end to an unparented child's left connection point. Or choose a replacement below.</p>
        <label className="form-field"><span>End to move</span><select value={end} disabled={action.pending} onChange={event => { setEnd(event.target.value as 'parent' | 'child'); setReplacementId(''); }}><option value="parent">Parent (left end)</option><option value="child">Child (right end)</option></select></label>
        <label className="form-field"><span>Reattach to objective</span><select value={replacementId} disabled={action.pending} onChange={event => setReplacementId(event.target.value)}><option value="">Choose an objective</option>{data.nodes.filter(o => eligibleReplacement(o.id)).map(o => <option key={o.id} value={o.id}>{o.title}</option>)}</select></label>
        <div className="heading-actions"><button className="primary-button" disabled={!replacementId || action.pending}>Reattach line</button><button type="button" className="secondary-button" disabled={action.pending} onClick={closeEditor}>Cancel reattachment</button></div>
      </form>}
      {removal ? <div role="group" aria-label="Confirm line removal"><p className="account-note">Remove this {alignment ? 'alignment' : 'dependency'} line? Both objectives are kept.</p><div className="heading-actions"><button ref={confirmRemoval} className="secondary-button danger-button" disabled={action.pending} onClick={() => commit(async () => { await send(`links/${removal.id}`, { sourceVersion: removal.sourceVersion, targetVersion: removal.targetVersion }, 'DELETE'); }, alignment ? 'Alignment line removed' : 'Dependency line removed')}>Confirm remove {alignment ? 'alignment' : 'dependency'}</button><button className="secondary-button" disabled={action.pending} onClick={() => { focusGraph.current = true; setRemoval(null); }}>Cancel line removal</button></div></div> : <button className="text-button" disabled={action.pending} onClick={() => requestRemoval()}>Remove {alignment ? 'alignment' : 'dependency'} line</button>}
    </section>}
  </>;
  return { action, selectedEdge, canCreate, canManage, canReconnect, chooseEdge, requestRemoval, validConnection, onConnectStart, onConnect, onReconnectStart, onReconnect, toolbar, lockNotice, editor };
}
