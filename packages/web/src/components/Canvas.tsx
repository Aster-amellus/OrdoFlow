import { useCallback, useMemo, useEffect } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap,
  type Connection, type Edge, type EdgeChange, type Node, type NodeChange,
  BackgroundVariant, useNodesState, useEdgesState, useReactFlow,
  Handle, MarkerType, Position, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { getLayers, findTaskById } from '@ordoflow/core';
import { useStore } from '../store';
import TaskNode from './TaskNode';
import { showToast } from '../browser';

function ExternalNode({ data }: NodeProps) {
  const external = data as unknown as { label: string; direction: 'incoming' | 'outgoing' };
  return (
    <div className="graph-external-node">
      {external.direction === 'outgoing' && <Handle type="target" position={Position.Left} className="graph-handle" />}
      <span className="graph-external-kicker">External</span>
      <span className="graph-external-title">{external.label}</span>
      {external.direction === 'incoming' && <Handle type="source" position={Position.Right} className="graph-handle" />}
    </div>
  );
}

const nodeTypes = { taskNode: TaskNode, externalNode: ExternalNode };

const NODE_WIDTH = 180;
const NODE_HEIGHT = 62;
const LAYER_GAP = 70;
const NODE_GAP = 28;
const CANVAS_PAD_X = 56;
const CANVAS_PAD_Y = 56;

export default function Canvas() {
  const root = useStore((s) => s.root);
  const inbox = useStore((s) => s.inbox);
  const currentProjectId = useStore((s) => s.currentProjectId);
  const dependencies = useStore((s) => s.dependencies);
  const addSubtask = useStore((s) => s.addSubtask);
  const addDependency = useStore((s) => s.addDependency);
  const deleteDependency = useStore((s) => s.deleteDependency);
  const updateTask = useStore((s) => s.updateTask);
  const selectTask = useStore((s) => s.selectTask);
  const { fitView } = useReactFlow();

  const project = currentProjectId === '__inbox__'
    ? inbox
    : currentProjectId
    ? findTaskById(root, currentProjectId) || root
    : root;

  const siblings = project.subtasks;
  const layers = useMemo(() => {
    if (siblings.length === 0) return [];
    return getLayers(siblings, dependencies);
  }, [siblings, dependencies]);

  const { initialNodes, initialEdges, autoPositions } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const autoPositions = new Map<string, { x: number; y: number }>();
    const siblingIds = new Set(siblings.map((t) => t.id));
    const taskPositions = new Map<string, { x: number; y: number }>();
    const taskLabels = new Map<string, string>();

    const collectLabels = (task: typeof root, prefix = '') => {
      const label = prefix ? `${prefix} / ${task.title}` : task.title;
      taskLabels.set(task.id, label);
      task.subtasks.forEach(child => collectLabels(child, label));
    };
    collectLabels(root);
    collectLabels(inbox);

    const hasIncomingExternal = dependencies.some(
      dep => !siblingIds.has(dep.fromTaskId) && siblingIds.has(dep.toTaskId)
    );
    const realStartX = hasIncomingExternal ? CANVAS_PAD_X + NODE_WIDTH + LAYER_GAP : CANVAS_PAD_X;

    layers.forEach((layer, layerIndex) => {
      const autoX = realStartX + layerIndex * (NODE_WIDTH + LAYER_GAP);
      const totalHeight = layer.length * NODE_HEIGHT + Math.max(0, layer.length - 1) * NODE_GAP;
      const waveOffset = layer.length === 1 ? (layerIndex % 2 === 0 ? 0 : 28) : 0;
      let autoY = CANVAS_PAD_Y + Math.max(0, (280 - totalHeight) / 2) + waveOffset;
      for (const task of layer) {
        const autoPos = { x: autoX, y: autoY };
        const hasStoredPosition = task.position.x !== 0 || task.position.y !== 0;
        const pos = hasStoredPosition ? task.position : autoPos;
        autoPositions.set(task.id, autoPos);
        taskPositions.set(task.id, pos);
        nodes.push({
          id: task.id,
          type: 'taskNode',
          position: pos,
          data: { ...task },
          draggable: true,
        });
        autoY += NODE_HEIGHT + NODE_GAP;
      }
    });

    const externalIncomingByTask = new Map<string, number>();
    const externalOutgoingByTask = new Map<string, number>();
    for (const dep of dependencies) {
      if (siblingIds.has(dep.fromTaskId) && siblingIds.has(dep.toTaskId)) {
        const src = siblings.find((t) => t.id === dep.fromTaskId);
        const done = src?.status === 'done';
        edges.push({
          id: dep.id,
          source: dep.fromTaskId,
          target: dep.toTaskId,
          type: 'default',
          animated: !done,
          interactionWidth: 18,
          style: { stroke: done ? 'var(--accent)' : 'var(--edge)', strokeWidth: 1.35 },
          markerEnd: { type: MarkerType.Arrow, color: done ? 'var(--accent)' : 'var(--edge)', width: 18, height: 18 },
        });
      } else if (!siblingIds.has(dep.fromTaskId) && siblingIds.has(dep.toTaskId)) {
        const targetPos = taskPositions.get(dep.toTaskId);
        if (!targetPos) continue;
        const count = externalIncomingByTask.get(dep.toTaskId) || 0;
        externalIncomingByTask.set(dep.toTaskId, count + 1);
        const externalId = `external-in-${dep.id}`;
        nodes.push({
          id: externalId,
          type: 'externalNode',
          position: {
            x: CANVAS_PAD_X,
            y: targetPos.y + count * (NODE_HEIGHT + 12),
          },
          data: {
            label: taskLabels.get(dep.fromTaskId) || dep.fromTaskId,
            direction: 'incoming',
            taskId: dep.fromTaskId,
          },
          draggable: false,
          connectable: false,
          selectable: true,
        });
        edges.push({
          id: dep.id,
          source: externalId,
          target: dep.toTaskId,
          type: 'default',
          animated: true,
          interactionWidth: 18,
          style: { stroke: 'var(--warning)', strokeWidth: 1.35, strokeDasharray: '4 7' },
          markerEnd: { type: MarkerType.Arrow, color: 'var(--warning)', width: 18, height: 18 },
        });
      } else if (siblingIds.has(dep.fromTaskId) && !siblingIds.has(dep.toTaskId)) {
        const sourcePos = taskPositions.get(dep.fromTaskId);
        if (!sourcePos) continue;
        const count = externalOutgoingByTask.get(dep.fromTaskId) || 0;
        externalOutgoingByTask.set(dep.fromTaskId, count + 1);
        const externalId = `external-out-${dep.id}`;
        nodes.push({
          id: externalId,
          type: 'externalNode',
          position: {
            x: sourcePos.x,
            y: sourcePos.y + NODE_HEIGHT + NODE_GAP + count * (NODE_HEIGHT + 12),
          },
          data: {
            label: taskLabels.get(dep.toTaskId) || dep.toTaskId,
            direction: 'outgoing',
            taskId: dep.toTaskId,
          },
          draggable: false,
          connectable: false,
          selectable: true,
        });
        edges.push({
          id: dep.id,
          source: dep.fromTaskId,
          target: externalId,
          type: 'default',
          animated: true,
          interactionWidth: 18,
          style: { stroke: 'var(--warning)', strokeWidth: 1.35, strokeDasharray: '4 7' },
          markerEnd: { type: MarkerType.Arrow, color: 'var(--warning)', width: 18, height: 18 },
        });
      }
    }

    return { initialNodes: nodes, initialEdges: edges, autoPositions };
  }, [layers, dependencies, siblings, root, inbox]);

  const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChange(changes);
      changes.forEach((c) => {
        if (c.type === 'position' && c.position && c.dragging === false) {
          updateTask(c.id, { position: c.position });
        }
      });
    },
    [onNodesChange, updateTask]
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      onEdgesChange(changes);
      changes.forEach((c) => {
        if (c.type === 'remove') deleteDependency(c.id);
      });
    },
    [deleteDependency, onEdgesChange]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (connection.source && connection.target) {
        if (!addDependency(connection.source, connection.target)) {
          showToast('Cannot add dependency', 'error');
        }
      }
    },
    [addDependency]
  );

  const handleAutoArrange = useCallback(() => {
    autoPositions.forEach((position, id) => updateTask(id, { position }));
    window.setTimeout(() => fitView({ padding: 0.22, duration: 240 }), 0);
  }, [autoPositions, fitView, updateTask]);

  const handleDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('.react-flow__node')) return;
      if (target.closest('.react-flow__edge')) return;
      if (target.closest('.react-flow__controls')) return;
      if (target.closest('.react-flow__minimap')) return;

      const flowEl = (event.currentTarget as HTMLElement).querySelector('.react-flow__pane');
      if (!flowEl) return;
      const rect = flowEl.getBoundingClientRect();
      const task = addSubtask(currentProjectId || '__inbox__', 'New task', {
        position: { x: event.clientX - rect.left, y: event.clientY - rect.top },
      });
      selectTask(task.id);
    },
    [addSubtask, selectTask, currentProjectId]
  );

  if (siblings.length === 0) {
    return (
      <div className="canvas-wrapper">
        <div className="canvas-empty">
          <p>No tasks yet. Use the list view to add tasks first.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="canvas-wrapper">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={onConnect}
        onNodeClick={(_, node) => selectTask((node.data as { taskId?: string }).taskId || node.id)}
        onDoubleClick={handleDoubleClick}
        nodeTypes={nodeTypes}
        deleteKeyCode={['Backspace', 'Delete']}
        panOnDrag={[0, 1, 2]}
        zoomOnScroll={true}
        selectNodesOnDrag={false}
        nodesDraggable={true}
        edgesFocusable={true}
        fitView
        fitViewOptions={{ padding: 0.2 }}
      >
        <div className="canvas-layout-tools">
          <button onClick={handleAutoArrange} className="btn-secondary">
            Auto arrange
          </button>
        </div>
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--border)" />
        <Controls />
        <MiniMap
          nodeColor={(node) => {
            const t = siblings.find((tk) => tk.id === node.id);
            if (!t) return 'var(--border)';
            if (t.status === 'done') return 'var(--accent)';
            if (t.status === 'in_progress') return 'var(--warning)';
            return 'var(--border)';
          }}
          style={{ background: 'var(--bg-card)' }}
        />
      </ReactFlow>
    </div>
  );
}
