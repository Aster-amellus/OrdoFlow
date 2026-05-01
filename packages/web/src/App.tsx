import { useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import Board from './components/Board';
import TaskList from './components/TaskList';
import Canvas from './components/Canvas';
import DetailPanel from './components/DetailPanel';
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

  // Initialize from URL
  useEffect(() => {
    const { view, projectId } = parsePath(window.location.pathname);
    if (view === 'project' && projectId) {
      goToProject(projectId);
      // Update URL without adding history entry (replace initial state)
      window.history.replaceState(null, '', `/project/${projectId}`);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for browser back/forward
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
        <ToastContainer />
      </div>
    </ReactFlowProvider>
  );
}
