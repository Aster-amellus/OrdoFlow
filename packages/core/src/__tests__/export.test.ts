import { describe, it, expect } from 'vitest';
import type { Task, Dependency } from '../types';
import {
  serializeState, serializeProject, extractProject,
  validateImport, mergeImport,
} from '../export';

function makeTask(id: string, title: string, opts?: Partial<Task>): Task {
  return {
    id, title, status: 'pending', position: { x: 0, y: 0 }, priority: 2,
    subtasks: [], tags: [], createdAt: '', ...opts,
  };
}

function makeDep(id: string, fromId: string, toId: string): Dependency {
  return { id, fromTaskId: fromId, toTaskId: toId };
}

function makeInbox(): Task {
  return { id: '__inbox__', title: 'Inbox', status: 'pending', position: { x: 0, y: 0 }, priority: 0, subtasks: [], tags: [], createdAt: '' };
}

function makeRoot(): Task {
  return { id: '__root__', title: 'Root', status: 'pending', position: { x: 0, y: 0 }, priority: 0, subtasks: [], tags: [], createdAt: '' };
}

describe('serializeState', () => {
  it('produces valid JSON', () => {
    const json = serializeState(makeRoot(), makeInbox(), []);
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(1);
    expect(parsed.type).toBe('full');
    expect(parsed.data.root).toBeDefined();
    expect(parsed.data.inbox).toBeDefined();
    expect(parsed.data.dependencies).toEqual([]);
  });

  it('includes projects in root.subtasks', () => {
    const root = makeRoot();
    root.subtasks = [makeTask('p1', 'Project')];
    const json = serializeState(root, makeInbox(), []);
    const parsed = JSON.parse(json);
    expect(parsed.data.root.subtasks).toHaveLength(1);
    expect(parsed.data.root.subtasks[0].title).toBe('Project');
  });

  it('includes dependencies', () => {
    const deps = [makeDep('d1', 'a', 'b')];
    const json = serializeState(makeRoot(), makeInbox(), deps);
    const parsed = JSON.parse(json);
    expect(parsed.data.dependencies).toHaveLength(1);
  });
});

describe('serializeProject', () => {
  it('exports single project', () => {
    const root = makeRoot();
    root.subtasks = [
      makeTask('p1', 'Project1'),
      makeTask('p2', 'Project2'),
    ];
    const deps = [makeDep('d1', 'p1', 'p2')];
    const json = serializeProject(root, 'p1', deps);
    const parsed = JSON.parse(json);
    expect(parsed.type).toBe('project');
    expect(parsed.projectName).toBe('Project1');
    expect(parsed.data.root.subtasks).toHaveLength(1);
    expect(parsed.data.root.subtasks[0].title).toBe('Project1');
    // Cross-project dep should be excluded
    expect(parsed.data.dependencies).toHaveLength(0);
  });

  it('includes deps within project subtree', () => {
    const childA = makeTask('a', 'Task A');
    const childB = makeTask('b', 'Task B');
    const root = makeRoot();
    root.subtasks = [makeTask('p1', 'Project', { subtasks: [childA, childB] })];
    const deps = [makeDep('d1', 'a', 'b')];
    const json = serializeProject(root, 'p1', deps);
    const parsed = JSON.parse(json);
    expect(parsed.data.dependencies).toHaveLength(1);
  });
});

describe('extractProject', () => {
  it('returns null for missing project', () => {
    const root = makeRoot();
    expect(extractProject(root, 'nope')).toBeNull();
  });

  it('returns the project task', () => {
    const root = makeRoot();
    root.subtasks = [makeTask('p1', 'Project')];
    expect(extractProject(root, 'p1')?.title).toBe('Project');
  });
});

describe('validateImport', () => {
  it('accepts valid payload', () => {
    const json = serializeState(makeRoot(), makeInbox(), []);
    const result = validateImport(json);
    expect(result.valid).toBe(true);
  });

  it('rejects non-JSON', () => {
    const result = validateImport('not json');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects missing data', () => {
    const result = validateImport('{}');
    expect(result.valid).toBe(false);
  });

  it('rejects missing root', () => {
    const result = validateImport('{"version":1,"data":{"inbox":{},"dependencies":[]}}');
    expect(result.valid).toBe(false);
  });

  it('rejects dependency cycles in imported data', () => {
    const root = makeRoot();
    root.subtasks = [
      makeTask('p1', 'Project', { subtasks: [makeTask('a', 'A'), makeTask('b', 'B')] }),
    ];
    const json = JSON.stringify({
      version: 1,
      exportedAt: '',
      type: 'full',
      data: {
        root,
        inbox: makeInbox(),
        dependencies: [makeDep('d1', 'a', 'b'), makeDep('d2', 'b', 'a')],
      },
    });

    const result = validateImport(json);
    expect(result.valid).toBe(false);
  });
});

describe('mergeImport', () => {
  it('skips duplicate IDs', () => {
    const existingRoot = makeRoot();
    existingRoot.subtasks = [makeTask('p1', 'Project')];
    const inbox = makeInbox();

    const importData = {
      version: 1, exportedAt: '', type: 'full' as const,
      data: {
        root: { ...makeRoot(), subtasks: [makeTask('p1', 'Duplicate')] },
        inbox: makeInbox(),
        dependencies: [],
      },
    };

    const result = mergeImport(existingRoot, inbox, [], importData);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    // Should still have only one project
    expect(result.root.subtasks).toHaveLength(1);
  });

  it('merges new projects', () => {
    const existingRoot = makeRoot();
    existingRoot.subtasks = [makeTask('p1', 'Project1')];
    const inbox = makeInbox();

    const importData = {
      version: 1, exportedAt: '', type: 'full' as const,
      data: {
        root: { ...makeRoot(), subtasks: [makeTask('p2', 'Project2')] },
        inbox: makeInbox(),
        dependencies: [],
      },
    };

    const result = mergeImport(existingRoot, inbox, [], importData);
    expect(result.root.subtasks).toHaveLength(2);
    expect(result.skipped).toBe(0);
  });

  it('skips cycle-causing deps', () => {
    const root = makeRoot();
    const a = makeTask('a', 'A');
    const b = makeTask('b', 'B');
    const c = makeTask('c', 'C');
    root.subtasks = [a, b, c];
    const deps = [makeDep('d1', 'a', 'b'), makeDep('d2', 'b', 'c')];

    const importData = {
      version: 1, exportedAt: '', type: 'full' as const,
      data: {
        root: makeRoot(),
        inbox: makeInbox(),
        dependencies: [makeDep('dx', 'c', 'a')],  // would create cycle
      },
    };

    const result = mergeImport(root, makeInbox(), deps, importData);
    expect(result.cycleSkips).toBe(1);
  });
});
