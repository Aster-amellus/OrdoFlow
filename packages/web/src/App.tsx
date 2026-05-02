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

function parsePath(path: string): { view: 'board' | 'project'; projectId: string | null } {
  const match = path.match(/^\/project\/(.+)$/);
  if (match) return { view: 'project', projectId: decodeURIComponent(match[1]) };
  return { view: 'board', projectId: null };
}

export default function App() {
  const currentView = useStore((s) => s.currentView);
  const viewMode = useStore((s) => s.viewMode);
  const selectedTaskId = useStore((s) => s.selectedTaskId);
  const loadData = useStore((s) => s.loadData);
  const goToBoard = useStore((s) => s.goToBoard);
  const goToProject = useStore((s) => s.goToProject);
  const startImport = useStore((s) => s.startImport);

  useEffect(() => {
    const saved = localStorage.getItem('ordoflow-data');
    if (saved) {
      try {
        const data = JSON.parse(saved);
        loadData({
          root: data.root,
          inbox: data.inbox,
          dependencies: data.dependencies,
        });
      } catch (e) {
        console.error('Failed to load saved data:', e);
      }
    }
  }, [loadData]);

  useEffect(() => {
    const { view, projectId } = parsePath(window.location.pathname);
    if (view === 'project' && projectId) {
      goToProject(projectId);
      window.history.replaceState(null, '', `/project/${projectId}`);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handlePopState = () => {
      const { view, projectId } = parsePath(window.location.pathname);
      if (view === 'project' && projectId) {
        goToProject(projectId);
      } else {
        goToBoard();
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [goToBoard, goToProject]);

  useEffect(() => {
    const unsub = useStore.subscribe((state) => {
      localStorage.setItem('ordoflow-data', JSON.stringify({
        root: state.root,
        inbox: state.inbox,
        dependencies: state.dependencies,
      }));
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
          window.dispatchEvent(new CustomEvent('ordoflow-toast', {
            detail: { message: result.errors.join('. '), type: 'error' },
          }));
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
        <main className="main-content" style={{ paddingTop: 48 }}>
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
