import { useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import Board from './components/Board';
import TaskList from './components/TaskList';
import Canvas from './components/Canvas';
import DetailPanel from './components/DetailPanel';
import ImportModal from './components/ImportModal';
import Toolbar from './components/Toolbar';
import ToastContainer from './components/Toast';
import { useStore } from './store';
import { loadStoredData, parseRoute, saveStoredData, showToast } from './browser';

export default function App() {
  const currentView = useStore((s) => s.currentView);
  const viewMode = useStore((s) => s.viewMode);
  const selectedTaskId = useStore((s) => s.selectedTaskId);
  const loadData = useStore((s) => s.loadData);
  const syncRoute = useStore((s) => s.syncRoute);
  const startImport = useStore((s) => s.startImport);

  useEffect(() => {
    try {
      const data = loadStoredData();
      if (data) loadData(data);
    } catch (e) {
      console.error('Failed to load saved data:', e);
    }
  }, [loadData]);

  useEffect(() => {
    syncRoute(parseRoute(window.location.pathname));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handlePopState = () => {
      syncRoute(parseRoute(window.location.pathname));
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [syncRoute]);

  useEffect(() => {
    const unsub = useStore.subscribe((state) => {
      saveStoredData({
        root: state.root,
        inbox: state.inbox,
        dependencies: state.dependencies,
      });
    });
    return unsub;
  }, []);

  // Drag & drop import
  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (!file || !file.name.endsWith('.json')) return;

      const reader = new FileReader();
      reader.onload = () => {
        const result = startImport(reader.result as string);
        if (!result.valid) {
          showToast(result.errors.join('. '), 'error');
        }
      };
      reader.readAsText(file);
    };

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, [startImport]);

  return (
    <ReactFlowProvider>
      <div className="app">
        <Toolbar />
        <main className="main-content">
          {currentView === 'board' ? (
            <Board />
          ) : viewMode === 'list' ? (
            <TaskList />
          ) : (
            <Canvas />
          )}
        </main>
        {selectedTaskId && <DetailPanel />}
        <ImportModal />
        <ToastContainer />
      </div>
    </ReactFlowProvider>
  );
}
