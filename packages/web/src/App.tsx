import { useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import Board from './components/Board';
import TaskList from './components/TaskList';
import Canvas from './components/Canvas';
import DetailPanel from './components/DetailPanel';
import Toolbar from './components/Toolbar';
import ToastContainer from './components/Toast';
import { useStore } from './store';

export default function App() {
  const currentView = useStore((s) => s.currentView);
  const viewMode = useStore((s) => s.viewMode);
  const selectedTaskId = useStore((s) => s.selectedTaskId);
  const loadData = useStore((s) => s.loadData);

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
