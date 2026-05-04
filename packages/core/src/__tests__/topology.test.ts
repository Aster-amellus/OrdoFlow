import { describe, it, expect } from 'vitest';
import {
  createTask, findTaskById, findParentOf, updateTaskInTree,
  removeTaskFromTree, addSubtaskToTree, countRemaining, countTotal,
  createRoot, createInbox,
} from '../types';
import { sortSiblings, getLayers, wouldCreateCycle, getEffectiveStatus } from '../topology';
import { calculateProgress } from '../progress';
import { canAddDependency } from '../workspace';
import type { Task, Dependency } from '../types';

function dep(id: string, from: string, to: string): Dependency {
  return { id, fromTaskId: from, toTaskId: to };
}

function makeTask(id: string, title: string, opts?: Partial<Task>): Task {
  return { id, title, status: 'pending', position: { x: 0, y: 0 }, priority: 2, subtasks: [], tags: [], createdAt: '', ...opts };
}

describe('tree operations', () => {
  it('findTaskById finds nested task', () => {
    const child = makeTask('c', 'Child');
    const root = makeTask('r', 'Root', { subtasks: [child] });
    expect(findTaskById(root, 'c')?.title).toBe('Child');
  });

  it('findParentOf returns parent', () => {
    const grandchild = makeTask('gc', 'Grandchild');
    const child = makeTask('c', 'Child', { subtasks: [grandchild] });
    const root = makeTask('r', 'Root', { subtasks: [child] });
    expect(findParentOf(root, 'gc')?.id).toBe('c');
  });

  it('updateTaskInTree updates nested task', () => {
    const child = makeTask('c', 'Child');
    const root = makeTask('r', 'Root', { subtasks: [child] });
    const updated = updateTaskInTree(root, 'c', { title: 'Updated' });
    expect(findTaskById(updated, 'c')?.title).toBe('Updated');
  });

  it('removeTaskFromTree removes nested task', () => {
    const child = makeTask('c', 'Child');
    const root = makeTask('r', 'Root', { subtasks: [child] });
    const updated = removeTaskFromTree(root, 'c');
    expect(updated.subtasks).toHaveLength(0);
  });

  it('addSubtaskToTree adds to parent', () => {
    const root = makeTask('r', 'Root');
    const child = makeTask('c', 'Child');
    const updated = addSubtaskToTree(root, 'r', child);
    expect(updated.subtasks).toHaveLength(1);
    expect(updated.subtasks[0].id).toBe('c');
  });

  it('countRemaining counts non-done tasks', () => {
    const a = makeTask('a', 'A', { status: 'done' });
    const b = makeTask('b', 'B', { status: 'pending' });
    const c = makeTask('c', 'C', { status: 'in_progress' });
    const root = makeTask('r', 'Root', { subtasks: [a, b, c] });
    expect(countRemaining(root)).toBe(2);
  });

  it('countTotal counts all leaf tasks', () => {
    const a = makeTask('a', 'A');
    const b = makeTask('b', 'B');
    const root = makeTask('r', 'Root', { subtasks: [a, b] });
    expect(countTotal(root)).toBe(2);
  });
});

describe('sortSiblings', () => {
  it('sorts by priority', () => {
    const a = makeTask('a', 'A', { priority: 2 });
    const b = makeTask('b', 'B', { priority: 0 });
    const c = makeTask('c', 'C', { priority: 1 });
    const sorted = sortSiblings([a, b, c], [], 'priority');
    expect(sorted.map(t => t.id)).toEqual(['b', 'c', 'a']);
  });

  it('topological sort for manual mode', () => {
    const a = makeTask('a', 'A');
    const b = makeTask('b', 'B');
    const c = makeTask('c', 'C');
    const deps = [dep('d1', 'a', 'b'), dep('d2', 'b', 'c')];
    const sorted = sortSiblings([a, b, c], deps, 'manual');
    expect(sorted.map(t => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('returns original order on cycle', () => {
    const a = makeTask('a', 'A');
    const b = makeTask('b', 'B');
    const deps = [dep('d1', 'a', 'b'), dep('d2', 'b', 'a')];
    const sorted = sortSiblings([a, b], deps, 'manual');
    expect(sorted.map(t => t.id)).toEqual(['a', 'b']);
  });
});

describe('getLayers', () => {
  it('returns layers for linear chain', () => {
    const a = makeTask('a', 'A');
    const b = makeTask('b', 'B');
    const c = makeTask('c', 'C');
    const deps = [dep('d1', 'a', 'b'), dep('d2', 'b', 'c')];
    const layers = getLayers([a, b, c], deps);
    expect(layers).toEqual([[a], [b], [c]]);
  });

  it('groups independent tasks', () => {
    const a = makeTask('a', 'A');
    const b = makeTask('b', 'B');
    const deps = [dep('d1', 'a', 'b')];
    const layers = getLayers([a, b], deps);
    expect(layers).toEqual([[a], [b]]);
  });
});

describe('getEffectiveStatus', () => {
  it('returns own status for leaf', () => {
    const task = makeTask('a', 'A', { status: 'in_progress' });
    expect(getEffectiveStatus(task)).toBe('in_progress');
  });

  it('returns done when all children done', () => {
    const a = makeTask('a', 'A', { status: 'done' });
    const b = makeTask('b', 'B', { status: 'done' });
    const parent = makeTask('p', 'P', { subtasks: [a, b] });
    expect(getEffectiveStatus(parent)).toBe('done');
  });
});

describe('wouldCreateCycle', () => {
  it('returns false for no cycle', () => {
    const deps = [dep('d1', 'a', 'b')];
    expect(wouldCreateCycle(deps, 'b', 'c')).toBe(false);
  });

  it('returns true for cycle', () => {
    const deps = [dep('d1', 'a', 'b'), dep('d2', 'b', 'c')];
    expect(wouldCreateCycle(deps, 'c', 'a')).toBe(true);
  });

  it('returns true for self-loop', () => {
    expect(wouldCreateCycle([], 'a', 'a')).toBe(true);
  });
});

describe('canAddDependency', () => {
  it('allows cross-project dependencies outside inbox', () => {
    const a = makeTask('a', 'A');
    const b = makeTask('b', 'B');
    const root = createRoot();
    root.subtasks = [
      makeTask('p1', 'Project 1', { subtasks: [a] }),
      makeTask('p2', 'Project 2', { subtasks: [b] }),
    ];

    expect(canAddDependency([], 'a', 'b', { root, inbox: createInbox() })).toEqual({ ok: true });
  });

  it('rejects inbox dependencies', () => {
    const inbox = createInbox();
    inbox.subtasks = [makeTask('i1', 'Inbox task'), makeTask('i2', 'Inbox task 2')];

    expect(canAddDependency([], 'i1', 'i2', { root: createRoot(), inbox })).toEqual({
      ok: false,
      reason: 'inbox',
    });
  });
});

describe('calculateProgress', () => {
  it('leaf task done = 100%', () => {
    const task = makeTask('a', 'A', { status: 'done' });
    expect(calculateProgress(task).percentage).toBe(100);
  });

  it('parent progress from children', () => {
    const a = makeTask('a', 'A', { status: 'done' });
    const b = makeTask('b', 'B', { status: 'pending' });
    const parent = makeTask('p', 'P', { subtasks: [a, b] });
    const p = calculateProgress(parent);
    expect(p.percentage).toBe(50);
    expect(p.done).toBe(1);
    expect(p.pending).toBe(1);
  });
});
