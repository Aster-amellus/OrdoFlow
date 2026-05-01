import { useCallback, useMemo, useEffect } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap,
  type Connection, type Edge, type Node,
  BackgroundVariant, useNodesState, useEdgesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { getLayers, findTaskById } from '@ordoflow/core';
import { useStore } from '../store';
import TaskNode from './TaskNode';

const nodeTypes = { taskNode: TaskNode };

const NODE_WIDTH = 180;
const NODE_HEIGHT = 60;
const LAYER_GAP = 120;
const NODE_GAP = 20;

export default function Canvas() {
  const root = useStore((s) => s.root);
  const inbox = useStore((s) => s.inbox);
  const currentProjectId = useStore((s) => s.currentProjectId);
  const dependencies = useStore((s) => s.dependencies);
  const addSubtask = useStore((s) => s.addSubtask);
  const addDependency = useStore((s) => s.addDependency);
  const updateTask = useStore((s) => s.updateTask);
  const selectTask = useStore((s) => s.selectTask);

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

  const { initialNodes, initialEdges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const siblingIds = new Set(siblings.map((t) => t.id));

    let autoX = 40;
    for (const layer of layers) {
      let autoY = 40;
      for (const task of layer) {
        // Use stored position, otherwise auto-layout
        const pos = (task.position.x > 0 || task.position.y > 0)
          ? task.position
          : { x: autoX, y: autoY };
        nodes.push({
          id: task.id,
          type: 'taskNode',
          position: pos,
          data: { ...task },
          draggable: true,
        });
        autoY += NODE_HEIGHT + NODE_GAP;
      }
      autoX += NODE_WIDTH + LAYER_GAP;
    }

    for (const dep of dependencies) {
      if (siblingIds.has(dep.fromTaskId) && siblingIds.has(dep.toTaskId)) {
        const src = siblings.find((t) => t.id === dep.fromTaskId);
        const done = src?.status === 'done';
        edges.push({
          id: dep.id,
          source: dep.fromTaskId,
          target: dep.toTaskId,
          animated: !done,
          style: { stroke: done ? 'var(--accent)' : 'var(--border-hover)', strokeWidth: 1.5 },
        });
      }
    }

    return { initialNodes: nodes, initialEdges: edges };
  }, [layers, dependencies, siblings]);

  const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const handleNodesChange = useCallback(
    (changes: any[]) => {
      onNodesChange(changes);
      changes.forEach((c) => {
        if (c.type === 'position' && c.position && c.dragging === false) {
          updateTask(c.id, { position: c.position });
        }
      });
    },
    [onNodesChange, updateTask]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (connection.source && connection.target) {
        if (!addDependency(connection.source, connection.target)) {
          window.dispatchEvent(new CustomEvent('ordoflow-toast', {
            detail: { message: 'Cannot add — would create a cycle', type: 'error' },
          }));
        }
      }
    },
    [addDependency]
  );

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
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={(_, node) => selectTask(node.id)}
        onDoubleClick={handleDoubleClick}
        nodeTypes={nodeTypes}
        deleteKeyCode="Delete"
        panOnDrag={[0, 1, 2]}
        zoomOnScroll={true}
        selectNodesOnDrag={false}
      >
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
