import { useState, useRef, useEffect } from 'react';
import { useStore } from '../store';
import { INBOX_ID } from '@ordoflow/core';

export default function QuickAdd() {
  const [title, setTitle] = useState('');
  const currentProjectId = useStore((s) => s.currentProjectId);
  const addSubtask = useStore((s) => s.addSubtask);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleAdd = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const parentId = currentProjectId || INBOX_ID;
    addSubtask(parentId, trimmed);
    setTitle('');
    inputRef.current?.focus();
  };

  return (
    <div className="quick-add">
      <input
        ref={inputRef}
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        placeholder="Add a task... (press / to focus)"
        className="quick-add-input"
      />
      <button onClick={handleAdd} disabled={!title.trim()} className="quick-add-btn">Add</button>
    </div>
  );
}
