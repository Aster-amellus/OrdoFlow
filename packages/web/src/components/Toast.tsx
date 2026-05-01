import { useState, useEffect } from 'react';

interface Toast { id: string; message: string; type: 'success' | 'error' | 'info'; }

export default function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const id = Math.random().toString(36).slice(2);
      setToasts((prev) => [...prev, { id, message: detail.message, type: detail.type }]);
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000);
    };
    window.addEventListener('ordoflow-toast', handler);
    return () => window.removeEventListener('ordoflow-toast', handler);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((t) => <div key={t.id} className={`toast toast-${t.type}`}>{t.message}</div>)}
    </div>
  );
}
