import { useMemo, useState } from 'react';
import { getLayers, calculateCriticalPath, sortSiblings, findTaskById } from '@ordoflow/core';
import { useStore } from '../store';
import QuickAdd from './QuickAdd';
import LayerSection from './LayerSection';

export default function TaskList() {
  const root = useStore((s) => s.root);
  const inbox = useStore((s) => s.inbox);
  const currentProjectId = useStore((s) => s.currentProjectId);
  const dependencies = useStore((s) => s.dependencies);
  const sortModes = useStore((s) => s.sortModes);
  const selectedTaskIds = useStore((s) => s.selectedTaskIds);
  const deleteSelectedTasks = useStore((s) => s.deleteSelectedTasks);
  const clearSelection = useStore((s) => s.clearSelection);

  const [isSelectionMode, setIsSelectionMode] = useState(false);

  const project = useMemo(() => {
    if (currentProjectId === '__inbox__') return inbox;
    if (!currentProjectId) return root;
    return findTaskById(root, currentProjectId) || root;
  }, [root, inbox, currentProjectId]);

  const siblings = project.subtasks;
  const sortMode = sortModes[currentProjectId || ''] || 'manual';

  const sorted = useMemo(() => sortSiblings(siblings, dependencies, sortMode), [siblings, dependencies, sortMode]);
  const layers = useMemo(() => getLayers(sorted, dependencies), [sorted, dependencies]);
  const criticalPath = useMemo(() => calculateCriticalPath(siblings, dependencies), [siblings, dependencies]);
  const criticalTaskIds = new Set(criticalPath.path.map((t) => t.id));

  const isLayerDone = (layer: typeof siblings) => layer.every((t) => t.status === 'done');
  const actionableIndex = layers.findIndex((l) => !isLayerDone(l));

  const handleDeleteSelected = () => {
    if (selectedTaskIds.size === 0) return;
    deleteSelectedTasks();
    setIsSelectionMode(false);
  };

  const handleToggleSelectionMode = () => {
    if (isSelectionMode) {
      clearSelection();
      setIsSelectionMode(false);
    } else {
      setIsSelectionMode(true);
    }
  };

  if (siblings.length === 0) {
    return (
      <div className="task-list">
        <QuickAdd />
        <div className="empty-state">
          <p className="empty-title">No tasks yet</p>
          <p className="empty-subtitle">Type above to add your first task</p>
        </div>
      </div>
    );
  }

  return (
    <div className="task-list">
      <QuickAdd />

      <div className="task-list-toolbar">
        <button
          className={`task-list-toolbar-btn ${isSelectionMode ? 'task-list-toolbar-btn-active' : ''}`}
          onClick={handleToggleSelectionMode}
        >
          {isSelectionMode ? 'Cancel' : 'Select'}
        </button>

        {isSelectionMode && selectedTaskIds.size > 0 && (
          <button className="task-list-toolbar-btn task-list-toolbar-btn-danger" onClick={handleDeleteSelected}>
            Delete ({selectedTaskIds.size})
          </button>
        )}

        {isSelectionMode && (
          <span className="task-list-toolbar-hint">
            Click tasks to select · Ctrl/Cmd+Click for multi-select
          </span>
        )}
      </div>

      <div className="layers-container">
        {layers.map((layer, i) => (
          <LayerSection
            key={i}
            layerIndex={i}
            tasks={layer}
            allTasks={sorted}
            isActionable={i === actionableIndex}
            criticalTaskIds={criticalTaskIds}
            isSelectionMode={isSelectionMode}
          />
        ))}
      </div>
    </div>
  );
}
