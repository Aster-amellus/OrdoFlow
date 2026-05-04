# OrdoFlow — 完整架构文档 & Code Review

> 2026 行 TypeScript/React/CSS · 19 个测试 · 2 个 package 的 Monorepo
>
> Author: Aster · Date: 2026-05-02

---

## 目录

1. [渲染的起点：从 `pnpm dev` 到屏幕像素](#1-从-pnpm-dev-到屏幕像素)
2. [Monorepo：一个仓库管理多个包](#2-monorepo)
3. [TypeScript 类型系统精要](#3-typescript-类型系统精要)
4. [核心数据结构：递归 Task 树](#4-递归-task-树)
5. [图论算法：拓扑排序与环检测](#5-拓扑排序与环检测)
6. [进度计算：递归累加](#6-进度计算)
7. [关键路径：CPM 算法](#7-关键路径)
8. [Zustand：状态管理](#8-zustand-状态管理)
9. [React 深度原理](#9-react-深度原理)
10. [React Flow：节点图渲染](#10-react-flow)
11. [AI 集成](#11-ai-集成)
12. [URL 路由](#12-url-路由)
13. [Tailwind CSS 样式系统](#13-tailwind-css)
14. [完整组件树](#14-完整组件树)
15. [Code Review](#15-code-review)
16. [与其他框架对比](#16-与其他框架对比)

---

## 1. 从 `pnpm dev` 到屏幕像素

```
Step 1 — 终端
  你敲：cd packages/web && pnpm dev
  终端执行 packages/web/package.json 中的 "dev": "vite"

Step 2 — Vite 服务器启动
  读取 vite.config.ts → 加载 @vitejs/plugin-react 插件
  React 插件提供：
    · JSX Transform（自动 import React → React 17+ 不再需要显式 import）
    · Fast Refresh（改组件代码不丢失页面状态）
  读取 index.html → 发现 <script type="module" src="/src/main.tsx">
  生成 HTML 包裹后返回给浏览器：
    <html>
      <body>
        <div id="root"></div>
        <script type="module" src="/src/main.tsx"></script>
      </body>
    </html>
  启动 HTTP 服务器 → http://localhost:3000

Step 3 — 浏览器发起请求
  浏览器 GET / → Vite 返回上述 HTML
  浏览器解析 HTML → 发现 <script type="module" src="/src/main.tsx">
  浏览器再 GET /src/main.tsx

Step 4 — Vite 即时编译（关键步骤）
  Vite 收到 /src/main.tsx 的请求：

  (A) 依赖预构建 (Pre-bundling)
      react、react-dom、zustand 这些库在 node_modules 里，用 CommonJS
      格式（require/exports）。Vite 用 esbuild（Go 写的超快编译器）
      把它们转成 ESM 格式（export/import），缓存在 node_modules/.vite/。

  (B) 即时编译 TSX → JS
      编译前（main.tsx）：
        import React from 'react';
        import ReactDOM from 'react-dom/client';
        import App from './App';

      编译后（浏览器能懂的 ESM）：
        import React from '/node_modules/.vite/react.js';
        import ReactDOM from '/node_modules/.vite/react-dom.js';
        import App from '/src/App.tsx';  // 浏览器会递归 GET

  (C) 递归加载依赖链
      浏览器执行 JS → 遇到 import App from './App.tsx'
      → GET /src/App.tsx → Vite 编译 App.tsx
      → 发现 import Board from './components/Board.tsx'
      → GET /src/components/Board.tsx → Vite 编译
      → ... 继续递归直到所有依赖加载完毕

Step 5 — React 渲染
  ReactDOM.createRoot(document.getElementById('root'))
    → 找到 index.html 里的 <div id="root">
    → 创建 Root 对象（React 18 的 Concurrent Root）
    → Root 内部维护 Fiber Tree（React 的虚拟 DOM 数据结构）

  root.render(<App />)
    → React 调用 App() 函数
    → App() 返回 JSX：

        <ReactFlowProvider>
          <div className="app">
            <Toolbar />
            <main>
              {view === 'board' ? <Board /> : <TaskList />}
            </main>
            {selectedTaskId && <DetailPanel />}
            <ToastContainer />
          </div>
        </ReactFlowProvider>

    → React 创建 Fiber Node 树（每层 JSX 元素 → 一个 Fiber Node）
    → React 对比 Fiber Tree 与真实 DOM（首次渲染 → 真实 DOM 为空）
    → Commit Phase：遍历 Fiber Tree，创建真实 DOM 节点并插入到 <div id="root">

Step 6 — 像素阶段
  浏览器拿到 DOM 树 + CSSOM 树：
    1. Recalculate Style：计算每个元素的最终样式（继承 + 级联）
    2. Layout（Reflow）：计算每个元素的盒模型（x, y, width, height）
    3. Paint：生成绘制指令（背景 → 文字 → 边框 → 阴影）
    4. Composite：GPU 将各图层合成到屏幕上

  你看到了 OrdoFlow。 🎉
```

### "为什么 Vite 比 webpack 快？"

| | Vite | webpack |
|---|---|---|
| 开发模式 | 浏览器原生 ESM，按需编译 | 先打包整个应用，再启动服务器 |
| 冷启动 | <1 秒 | 几十秒（大项目） |
| HMR（热更新） | 只重新编译改动的文件 | 需要部分重新打包 |
| 编译器 | esbuild (Go 语言) | tsc / babel (JS) |
| 预构建 | esbuild 预构建 node_modules | babel-loader 转译每个文件 |

Vite 的核心思想：**开发时不打包。** 每个文件作为独立的 HTTP 请求按需编译。浏览器原生 ES Module import 机制就是天然的"按需加载"。

---

## 2. Monorepo：一个仓库管理多个包

### 什么是 Monorepo

```
传统 Multirepo：            Monorepo：
  /frontend/  .git           /OrdoFlow/  .git
  /backend/   .git             packages/
  /shared/    .git               core/    ← 共享代码
                                  web/     ← 前端应用
                    优势：
                    · 一次 commit 改多个包
                    · 类型提示跨包生效
                    · CI/CD 统一管理
```

### pnpm workspace 的原理

```yaml
# pnpm-workspace.yaml — 声明哪些目录是子包
packages:
  - "packages/*"
```

pnpm 扫描 `packages/` 下的每个子目录，读取 `package.json` 中的 `name` 字段：

```
packages/core/package.json   → name: "@ordoflow/core"
packages/web/package.json    → name: "@ordoflow/web"
```

当一个包依赖另一个 workspace 包时，使用 `workspace:*` 协议：

```json
// packages/web/package.json
{
  "dependencies": {
    "@ordoflow/core": "workspace:*"
  }
}
```

`workspace:*` 告诉 pnpm："不要从 npm 下载，直接链接本地的 packages/core 目录"。

pnpm 创建符号链接：

```
node_modules/@ordoflow/core → ../../packages/core
```

Vite 编译时遇到 `import { Task } from '@ordoflow/core'`：
1. 走到符号链接 → 读取 `packages/core/package.json`
2. `main` 字段指向 `./src/index.ts`
3. 直接读取 TypeScript 源码 → esbuild 编译
4. **不需要先 build core 包**

这就是"源码链接"（source linking）。改动 core 包的代码后，Vite 的 HMR 立即反映到 web 包。

### 为什么不用 Nx / Lerna？

| 工具 | 适用场景 | 为什么 OrdoFlow 不需要 |
|------|---------|----------------------|
| Nx / Turborepo | 几十个包、复杂构建依赖、需要缓存 | 只有 2 个包 |
| Lerna | 历史遗留方案，已被 Nx 取代 | 过时且慢 |
| pnpm workspace | 2-20 个包的小型 Monorepo | 最轻量，零额外依赖 |

---

## 3. TypeScript 类型系统精要

### 核心概念

> TypeScript 的所有类型标注在编译后**完全消失**。运行时执行的是纯 JavaScript，没有类型信息。

```
源码 (TypeScript):                     编译后 (JavaScript):
  type Status = 'a' | 'b';              // 这行消失了
  let s: Status = 'a';                  let s = 'a';
  function f(x: number): string {       function f(x) {
    return x.toString();                  return x.toString();
  }                                     }
```

类型检查只在编译时发生。如果类型不对，**在浏览器打开之前就已经失败了**。这是 TypeScript 的核心价值：在开发时捕获错误，而不是用户的使用中。

### 项目中用到的关键 TS 特性

#### 1. 字面量联合 (Literal Union)

```typescript
type TaskStatus = 'pending' | 'in_progress' | 'done';
// 不是 "任何 string"，只能是这三个字面量之一

function setStatus(status: TaskStatus) {}
setStatus('done');     // ✅
setStatus('completed'); // ❌ 编译错误
```

**原理**：编译器为每种字面量联合类型维护一个类型集合。当函数接受 `TaskStatus` 时，编译器检查参数是否在集合中。当你用 `if/switch` 处理了所有分支时，编译器还能进行"穷尽性检查"（exhaustiveness check），提醒你漏掉的 case。

**为什么不用 enum？** enum 编译后会生成运行时对象（有额外的 JS 代码和包大小开销）。`type` 字面量联合在编译后完全消失，零运行时成本。

#### 2. Optional 属性 (`?`)

```typescript
interface Task {
  id: string;            // 必填
  description?: string;  // 可选 — 等价于 string | undefined
}

const task: Task = { id: "a" }; // ✅ 可以没有 description
```

**实现原理**：TypeScript 编译器内部为每个属性维护一个 flags 位图。`Optional` 是其中一个 flag。当你访问 `task.description` 而不先检查 `undefined` 时（`task.description.length`），编译器报错。这强制了"防御式编程"。

#### 3. 递归类型引用

```typescript
interface Task {
  subtasks: Task[];  // Task 引用了自己 → 树结构
}
```

TypeScript 编译器维护一个类型引用图。递归类型需要**惰性求值**（lazy evaluation）—— 编译器推迟对 `Task` 内部 `Task[]` 的解析，否则会无限递归。

**技术限制**：`type` 别名在某些递归场景下不工作（因为它默认热切求值），`interface` 原生支持递归。项目中用 `interface` 是正确的。

#### 4. 泛型 (Generics)

```typescript
// 不用泛型 — 每个类型都要写一个函数
function firstString(arr: string[]): string | undefined { return arr[0]; }
function firstNumber(arr: number[]): number | undefined { return arr[0]; }

// 用泛型 — 一个函数适用所有类型
function first<T>(arr: T[]): T | undefined { return arr[0]; }
first<string>(["a", "b"]); // T = string，返回 string | undefined
first<number>([1, 2]);     // T = number，返回 number | undefined
```

**原理**：编译器在**调用点**把 `T` 替换成实际类型，然后对替换后的代码做类型检查。这称为**单态化**（monomorphization）。和 Rust 的泛型是同一概念，但 TS 的实现更轻（没有运行时代码生成）。

#### 5. `Partial<T>` — 内置工具类型

```typescript
// Partial 的定义（TypeScript 标准库）
type Partial<T> = { [K in keyof T]?: T[K] };

// 对 Task 展开：
// keyof Task → 'id' | 'title' | 'description' | 'status' | ...
// [K in keyof Task]?: T[K] → 遍历每个 key，加上 ?

type PartialTask = Partial<Task>;
// 等价于 { id?: string; title?: string; description?: string; ... }
```

在 `updateTask(id, partial)` 中，第二个参数是 `Partial<Task>`。调用者只传要修改的字段，其他字段保持原值。

#### 6. `!` 非空断言

```typescript
const task = taskMap.get(id);   // TypeScript: Task | undefined
const task = taskMap.get(id)!;  // ! 断言：我确定这不是 undefined
// 如果实际上不存在 → 运行时 TypeError
```

`!` 是给编译器看的（"我知道不可能是 null，别警告我"），但在运行时没有任何效果。项目中用得合理：Kahn 算法中，入度为 0 的节点一定在 `taskMap` 中（因为构建图时已确保）。

#### 7. `as const` — 收窄推断类型

```typescript
const colors = ['red', 'green'];        // TypeScript 推断为 string[]
const colors = ['red', 'green'] as const; // 推断为 readonly ['red', 'green']

// 后者在遍历时能推断出每个元素的精确字面量类型
// (['high', 'medium', 'detailed'] as const).map(g => ...)
// TS 知道 g 是 'high' | 'medium' | 'detailed'，不是 string
```

#### 8. Discriminated Union (标签联合) 与穷举检查

```typescript
type TaskStatus = 'pending' | 'in_progress' | 'done';

// 渲染逻辑：
switch (task.status) {
  case 'pending':     return <GrayBorder />;
  case 'in_progress': return <BlueGlow />;
  case 'done':        return <GreenStrikeThrough />;
  // 如果漏掉了某个 status，TS 编译器会报警
  // 因为函数没有 return 语句覆盖所有分支
}
```

---

## 4. 递归 Task 树 — 数据结构设计

### 两种树模型对比

**模型 A — 扁平化 + 外键（传统 SQL 风格）**

```typescript
const todos: Task[] = [
  { id: "a", parentId: null, title: "Root" },
  { id: "b", parentId: "a",  title: "Child" },
  { id: "c", parentId: "b",  title: "Grandchild" },
];

// 查找 B 的子节点 → 遍历整个数组 O(n)
const childrenOfB = todos.filter(t => t.parentId === "b");
// 查找 A 的所有后代 → 需要递归 filter 或手动构建树
```

**模型 B — 递归嵌套（OrdoFlow 的选择）**

```typescript
const root: Task = {
  id: "a", title: "Root",
  subtasks: [{
    id: "b", title: "Child",
    subtasks: [{ id: "c", title: "Grandchild", subtasks: [] }]
  }]
};

// 查找 B 的子节点 → 直接属性访问 O(1)
const childrenOfB = root.subtasks[0].subtasks;
// 遍历 A 的所有后代 → 直接递归 map
function renderAll(task: Task) {
  return <> {task.title} {task.subtasks.map(renderAll)} </>;
}
```

**对比**：

| | 扁平 + parentId | 递归嵌套 |
|---|---|---|
| 查找直接子节点 | O(n) 遍历 | O(1) 访问 |
| 序列化 | JSON（需维护引用完整性） | JSON（天然正确） |
| 不可变更新 | 拷贝整个数组 | 只重建路径 |
| SQL 查询 | 容易 | 困难（需要递归 CTE） |
| 前端渲染 | 需手动构建树后再递归 | 直接递归 map |
| Parent 状态推导 | 需要 JOIN/子查询 | 递归函数直接计算 |

OrdoFlow 没有后端、没有 SQL、不需要 JOIN。递归树是零成本的正确选择。

### 全局状态的两棵树

```
OrdoFlow State:
  root: Task {           ← 虚拟根节点（不可见，仅作容器）
    id: '__root__'
    subtasks: [
      Task "virtio-gpu",  ← 用户可见的 project
      Task "日常事务",
      Task "学习 Rust",
    ]
  }

  inbox: Task {          ← Inbox 根节点
    id: '__inbox__'
    subtasks: [
      Task "买菜",        ← 叶子任务
      Task "还信用卡",
    ]
  }

  dependencies: Dependency[] ← 所有依赖关系（平面数组，跨树）
```

`root` 和 `inbox` 是两棵独立的树。操作时需要知道任务在哪棵树中。这就是为什么 `addSubtask` 和 `updateTask` 都要检查 `findTaskById(inbox, id)`：

```typescript
addSubtask: (parentId, title, opts) => {
  set((state) => {
    if (findTaskById(state.inbox, parentId)) {
      return { inbox: addSubtaskToTree(state.inbox, parentId, task) };
    }
    return { root: addSubtaskToTree(state.root, parentId, task) };
  });
}
```

### 不可变更新的完整过程

```typescript
// 原始树：
const root = {
  id: '__root__',
  subtasks: [
    { id: 'a', title: 'Project A', subtasks: [
      { id: 'b', title: 'Task B', subtasks: [] }
    ]}
  ]
};

// 想要：把 'Task B' 的 status 改为 'done'

// ❌ 错误做法 — 直接修改
// root.subtasks[0].subtasks[0].status = 'done';
// 问题：引用没变 → React 检测不到变化 → 界面不更新

// ✅ 正确做法 — 不可变更新（Immutable Update）
const updateTaskInTree = (node: Task, id: string, updates: Partial<Task>): Task => {
  if (node.id === id) return { ...node, ...updates };     // 找到了 → 新对象
  return {
    ...node,                                               // 不是目标 → 新对象
    subtasks: node.subtasks.map(child =>                   //   但子节点可能变了
      updateTaskInTree(child, id, updates)
    ),
  };
};

const newRoot = updateTaskInTree(root, 'b', { status: 'done' });

// 结果：
//   root' (ref #200) ← 新对象
//   ├─ a' (ref #300) ← 新对象（因为它的子节点变了）
//   │   └─ b' (ref #400) ← 新对象（status 变了）
//
// 原理：
// · 只有路径上的节点（root → a → b）是新的
// · 路径外的节点（a 的其他子节点）保持旧引用
// · React 通过 === 比较引用：
//   · root' !== root → 重渲染 root
//   · a' !== a → 重渲染 a
//   · b' !== b → 重渲染 b
//   · 路径外的节点 === 自己 → 不渲染
```

### 树操作函数详解

#### `findTaskById(root, id)` — 深度优先搜索

```typescript
export function findTaskById(root: Task, id: string): Task | null {
  if (root.id === id) return root;          // base case：找到了
  for (const child of root.subtasks) {
    const found = findTaskById(child, id);  // recursive case：深入子节点
    if (found) return found;                // 短路：找到就返回
  }
  return null;                              // not found
}
```

**时间复杂度**：O(N)，N = 树中所有节点数。最坏情况遍历整棵树。

**为什么用 DFS 不用 BFS？**
- DFS 用调用栈回溯，代码简洁自然
- JS 调用栈深度约 10000，对任务树（深度通常 < 10）完全够用
- BFS 需要手动维护队列（`const queue = [root]; while (queue.length) ...`），代码更长
- DFS 和 BFS 的时间复杂度相同（O(N)），空间复杂度相似

#### `findParentOf(root, childId)` — 找父节点

```typescript
export function findParentOf(root: Task, childId: string): Task | null {
  for (const child of root.subtasks) {
    if (child.id === childId) return root;     // 直接子节点
    const found = findParentOf(child, childId); // 递归检查子节点的子节点
    if (found) return found;
  }
  return null;
}
```

**注意**：返回值是**父节点的 Task**，不是子节点的 id。用于需要"把 task X 移到 project Y 下面"这样的场景。

#### `removeTaskFromTree(root, id)` — 删除节点（含整个子树）

```typescript
export function removeTaskFromTree(root: Task, id: string): Task {
  return {
    ...root,
    subtasks: root.subtasks
      .filter(child => child.id !== id)               // 直接匹配
      .map(child => removeTaskFromTree(child, id)),   // 递归深入
  };
}
```

如果被删除的节点在深层（root → a → b → c，要删除 c）：
1. root：检查子节点 → 没有 c → 递归进入 a
2. a：检查子节点 → 没有 c → 递归进入 b
3. b：检查子节点 → c 匹配 → filter 排除 c
4. b 的其他子节点 → map 调用 removeTaskFromTree（它们的子树里也没有 c）
5. 沿路径返回新对象

**副作用处理**：删除节点时需要同时删除与它相关的所有依赖。这不在 `removeTaskFromTree` 中处理（它是纯函数，不接触 `dependencies`），而是在 store 的 `deleteTask` 中额外过滤：

```typescript
dependencies: state.dependencies.filter(
  d => !allIds.has(d.fromTaskId) && !allIds.has(d.toTaskId)
)
```

#### `addSubtaskToTree(root, parentId, subtask)` — 添加子任务

```typescript
export function addSubtaskToTree(root: Task, parentId: string, subtask: Task): Task {
  if (root.id === parentId) {
    return { ...root, subtasks: [...root.subtasks, subtask] };
  }
  return {
    ...root,
    subtasks: root.subtasks.map(child =>
      addSubtaskToTree(child, parentId, subtask)
    ),
  };
}
```

#### `countRemaining(task)` — 递归计数

```typescript
export function countRemaining(task: Task): number {
  if (task.subtasks.length === 0) {           // 叶子节点
    return task.status === 'done' ? 0 : 1;     // 1 或 0
  }
  return task.subtasks.reduce(               // 项目节点
    (sum, child) => sum + countRemaining(child), // 累加所有子节点
    0
  );
}
```

`reduce` — 函数式编程的核心操作。对每个元素执行回调，结果累积到累加器：

```
[1, 2, 3, 4].reduce((sum, x) => sum + x, 0)
// sum=0, x=1 → sum=1
// sum=1, x=2 → sum=3
// sum=3, x=3 → sum=6
// sum=6, x=4 → sum=10
// → 10
```

---

## 5. 图论算法：拓扑排序与环检测

### 图的基本概念

```
有向图 (Directed Graph)：
  节点 (Node/Vertex) = Task
  有向边 (Directed Edge) = Dependency (fromTaskId → toTaskId)

  A ──→ B  表示 "A 必须在 B 之前完成"
  \    /
   → C ←

术语：
  入度 (In-Degree)：指向该节点的边的数量
  邻接表 (Adjacency List)：Map<nodeId, neighborIds[]>

例子：
  A→B, A→C, B→D, C→D

  邻接表 adjList：
    { A: [B, C], B: [D], C: [D], D: [] }

  入度 inDegree：
    { A: 0, B: 1, C: 1, D: 2 }
```

### Kahn 算法（拓扑排序）

**核心思想**：
1. 找出所有入度为 0 的节点（没有前置依赖）→ 作为"当前可执行的层"
2. 执行这些节点 → 移除它们 → 减少后继节点的入度
3. 重复直到所有节点被处理

```
输入：A→B, A→C, B→D, C→D

初始化：
  inDegree = { A:0, B:1, C:1, D:2 }
  adjList  = { A:[B,C], B:[D], C:[D], D:[] }

──────────────────────────────────────

第0轮：queue = [A]  (A 的入度为 0)
  Layer 0 = [A]
  处理 A→B：B 的入度 1→0 → nextQueue=[B]
  处理 A→C：C 的入度 1→0 → nextQueue=[B, C]

第1轮：queue = [B, C]
  Layer 1 = [B, C]
  处理 B→D：D 的入度 2→1
  处理 C→D：D 的入度 1→0 → nextQueue=[D]

第2轮：queue = [D]
  Layer 2 = [D]

结果：[[A], [B, C], [D]]
```

**OrdoFlow 中的实现** — `getLayers()` (topology.ts:104-153):

```typescript
export function getLayers(siblings: Task[], dependencies: Dependency[]): Task[][] {
  // 1. 构建入度和邻接表
  const inDegree = new Map<string, number>();
  const adjList  = new Map<string, string[]>();

  for (const task of siblings) {
    inDegree.set(task.id, 0);
    adjList.set(task.id, []);
  }

  // 2. 遍历所有依赖（边），更新入度和邻接表
  for (const dep of dependencies) {
    // 只处理两端都在 siblings 中的边
    if (siblingIds.has(dep.fromTaskId) && siblingIds.has(dep.toTaskId)) {
      adjList.get(dep.fromTaskId)!.push(dep.toTaskId);        // from → to
      inDegree.set(dep.toTaskId, (inDegree.get(dep.toTaskId) || 0) + 1);
    }
  }

  // 3. 初始化队列：所有入度为 0 的节点
  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  // 4. 迭代处理
  const layers: Task[][] = [];
  while (queue.length > 0) {
    const layer: Task[] = [];
    const nextQueue: string[] = [];

    for (const id of queue) {
      const task = taskMap.get(id)!;
      layer.push(task);

      // 减少所有后继节点的入度
      for (const neighbor of adjList.get(id) || []) {
        const newDegree = (inDegree.get(neighbor) || 1) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) nextQueue.push(neighbor);
      }
    }

    layers.push(layer);
    queue.length = 0;           // 清空旧队列
    queue.push(...nextQueue);   // 装入下一层
  }

  // 5. 环检测：如果处理的节点数 < 总节点数 → 有环
  const visitedCount = layers.reduce((sum, l) => sum + l.length, 0);
  if (visitedCount < siblings.length) return [siblings];  // 有环 → 返回原数组
  return layers;
}
```

**时间复杂度 O(V+E)**：每个节点和每条边各访问一次。**空间 O(V)**：存储入度和邻接表。

### 环检测 — `wouldCreateCycle()`

```typescript
export function wouldCreateCycle(
  dependencies: Dependency[],
  from: string,  // 新的依赖关系：from → to
  to: string
): boolean {
  if (from === to) return true;  // 自己依赖自己 → 环

  // DFS 反向遍历：从 from 出发，沿着已有边的上游走
  // 如果走到了 to → 已存在 from→...→to 路径 → 添加 to→from 会形成环
  const visited = new Set<string>();
  const stack = [from];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === to) return true;  // 走到了目标 → 有环
    if (visited.has(current)) continue;
    visited.add(current);

    // 往上追溯：找所有指向 current 的边
    for (const dep of dependencies) {
      if (dep.toTaskId === current) {
        stack.push(dep.fromTaskId);
      }
    }
  }
  return false;
}
```

**工作原理**:

```
已有边：A→B, B→C
想要添加：C→A（反向边）

算法执行：
  stack = [C]
  pop C → 不是 A → visited = {C}
  找指向 C 的边 → B→C → push B
  pop B → 不是 A → visited = {C, B}
  找指向 B 的边 → A→B → push A
  pop A → A === A(目标) → return true ← 会形成环！
```

**时间复杂度 O(V+E)**，空间 O(V)。

---

## 6. 进度计算：递归累加

```typescript
export function calculateProgress(task: Task): TaskProgress {
  // ── 叶子节点 ──
  if (task.subtasks.length === 0) {
    return {
      percentage: task.status === 'done' ? 100 : 0,
      estimatedMinutesRemaining: task.status === 'done' ? 0
        : (task.estimatedMinutes || 0),
      pending:   task.status === 'pending'     ? 1 : 0,
      inProgress: task.status === 'in_progress' ? 1 : 0,
      done:      task.status === 'done'        ? 1 : 0,
      total: 1,
    };
  }

  // ── 项目节点 ── 递归累加所有子节点
  const progress = task.subtasks.map(c => calculateProgress(c));

  return {
    percentage: Math.round(
      (progress.filter(p => p.percentage === 100).length
       / task.subtasks.length)
      * 100
    ),
    estimatedMinutesRemaining: task.subtasks
      .filter(c => c.status !== 'done')
      .reduce((sum, c) =>
        sum + calculateProgress(c).estimatedMinutesRemaining, 0
      ),
    pending:    task.subtasks.filter(c => c.status === 'pending').length,
    inProgress: task.subtasks.filter(c => c.status === 'in_progress').length,
    done:       task.subtasks.filter(c => c.status === 'done').length,
    total: task.subtasks.length,
  };
}
```

**递归展开过程** — 以三层嵌套为例：

```
Project (3 个直接子任务)
 ├─ Task A (done, 30min)             → { pct: 100, remaining: 0 }
 └─ Task B (2 个子任务)
     ├─ B1 (done, 15min)             → { pct: 100, remaining: 0 }
     └─ B2 (pending, 45min)          → { pct: 0,   remaining: 45 }

自底向上合并：
  B  = calculateProgress(B)
      = { pct: 1/2 = 50%, remaining: 0 + 45 = 45min,
          pending: 1, inProgress: 0, done: 1, total: 2 }

  Project = calculateProgress(Project)
           = { pct: (1/3) ≈ 33%, remaining: 0 + 0 + 45 = 45min,
               pending: 0 + 1 = 1, inProgress: 0, done: 1 + 1 = 2,
               total: 3 }
```

---

## 7. 关键路径：CPM 算法

### Critical Path Method

**关键路径** = 从任意起点到终点的最长路径。路径上的任务如果延期，整个项目就会延期。非关键路径上的任务即使延期（只要不超过总关键路径长度），不影响整体交付。

**为什么用 CPM 而不是 Dijkstra？**

Dijkstra 找**最短**路径。CPM 找**最长**路径。在 DAG（有向无环图）中，最长路径等价于把边权重取负后跑最短路。用 DP（动态规划）更直接。

### 算法：两阶段 DP

```
阶段 1 — 正向 DP（计算每个任务的最早开始和最早完成时间）
  earliestStart[id]  = max(earliestFinish[所有前置任务])
  earliestFinish[id] = earliestStart[id] + duration[id]

阶段 2 — 反向回溯（沿最早完成时间最大的路径回退）
  从 earliestFinish 最大的节点出发
  找 earliestFinish 最大的前置节点 → 加入路径
  重复直到起点

瓶颈 = 关键路径上 estimatedMinutes 最大的任务
```

### OrdoFlow 实现

```typescript
export function calculateCriticalPath(
  siblings: Task[], dependencies: Dependency[]
): CriticalPathResult {
  // 1. 拓扑排序 → 得到处理顺序
  const order = topologicalOrder(siblings, dependencies);

  // 2. 递归计算每个任务的有效耗时（含子任务）
  function getEffectiveMinutes(task: Task): number {
    if (task.subtasks.length === 0) return task.estimatedMinutes || 0;
    return task.subtasks.reduce((sum, c) => sum + getEffectiveMinutes(c), 0);
  }

  // 3. 正向 DP
  const earliestStart  = new Map<string, number>();
  const earliestFinish = new Map<string, number>();

  for (const id of order) {
    const task = taskMap.get(id)!;
    const duration = getEffectiveMinutes(task);

    // 最早开始时间 = 所有前置任务最早完成时间的最大值
    let maxPrevFinish = 0;
    for (const prevId of reverseAdjList.get(id) || []) {
      maxPrevFinish = Math.max(maxPrevFinish, earliestFinish.get(prevId) || 0);
    }

    earliestStart.set(id, maxPrevFinish);
    earliestFinish.set(id, maxPrevFinish + duration);
  }

  // 4. 找最晚完成的任务
  let maxFinish = 0;
  let endTaskId = '';
  for (const [id, finish] of earliestFinish) {
    if (finish > maxFinish) { maxFinish = finish; endTaskId = id; }
  }

  // 5. 回溯构建关键路径
  const path: Task[] = [];
  let currentId = endTaskId;
  while (currentId) {
    const task = taskMap.get(currentId)!;
    path.unshift(task);  // unshift = 从头部插入

    // 找 earliestFinish 最大的前置节点
    let prevId = '';
    let prevFinish = 0;
    for (const pId of reverseAdjList.get(currentId) || []) {
      const finish = earliestFinish.get(pId) || 0;
      if (finish > prevFinish) { prevFinish = finish; prevId = pId; }
    }
    currentId = prevId;
  }

  // 6. 瓶颈 = 路径上 estimatedMinutes 最大的任务
  const bottleneck = path.reduce((max, task) =>
    !max || (task.estimatedMinutes || 0) > (max.estimatedMinutes || 0)
      ? task : max,
    null as Task | null
  );

  return { path, totalMinutes: maxFinish, bottleneck };
}
```

**时间复杂度 O(V+E)**，空间 O(V)。

---

## 8. Zustand：状态管理

### 为什么用 Zustand 而不是 Redux / Context

| | Zustand | Redux | React Context |
|---|---|---|---|
| 模板代码 | 极少（~10行定义一个 store） | 多（reducers + actions + action types） | 极少 |
| 性能 | 选择器级别的订阅（改 A 不影响读 B 的组件） | 同 Zustand（useSelector） | 订阅整个 Context（改了 A 重渲染所有消费者） |
| 中间件 | subscribe, devtools, persist, immer | 生态最丰富（中间件） | 无（需手动实现） |
| 包大小 | ~1KB | ~12KB（含 react-redux） | 0（React 内置） |
| 学习曲线 | 低 | 高 | 最低 |
| 适用场景 | 中小型到大型应用 | 大型、团队复杂协作的应用 | 小型应用、简单状态 |

Zustand 的核心理念：**store 就是一个 hook 工厂。** 不需要 Provider 包裹整个应用，不需要 `connect` HOC，直接用。

```typescript
const useStore = create<State>((set, get) => ({
  count: 0,
  increment: () => set(s => ({ count: s.count + 1 })),
}));

// 组件中使用
function Counter() {
  const count = useStore(s => s.count);        // 选择器订阅
  const increment = useStore(s => s.increment); // 选择器订阅
  return <button onClick={increment}>{count}</button>;
}
```

### OrdoFlow 的 Store 结构

```typescript
interface OrdoFlowState {
  // ── 核心数据 ──
  root: Task;                   // 树根（不可见，subtasks 是顶层 project）
  inbox: Task;                  // Inbox 根（特殊）
  dependencies: Dependency[];   // 所有依赖关系（平面数组）

  // ── 导航 ──
  currentView: 'board' | 'project';
  currentProjectId: string | null;

  // ── UI 状态 ──
  selectedTaskId: string | null;        // 右侧面板打开的 task
  selectedTaskIds: Set<string>;         // 批量选择的 task
  viewMode: 'list' | 'graph';           // project 内的子视图
  sortModes: Record<string, SortMode>; // 每个 projectId 的排序模式
  aiConfig: AIConfig;                   // API key 等

  // ── 操作 ──
  addTopLevelTask(title) → Task;
  addSubtask(parentId, title, opts?) → Task;
  updateTask(id, partial) → void;
  deleteTask(id) → void;
  deleteSelectedTasks() → void;
  setTaskStatus(id, status) → void;
  addDependency(fromId, toId) → boolean;
  deleteDependency(id) → void;
  goToBoard() → void;
  goToProject(id) → void;
  selectTask(id) → void;
  toggleTaskSelection(id) → void;
  clearSelection() → void;
  setViewMode(mode) → void;
  setSortMode(parentId, mode) → void;
  setAIConfig(partial) → void;
  loadData(data) → void;
}
```

### 选择器订阅机制

Zustand 通过选择器实现**精确订阅**：

```typescript
// ❌ 订阅整个 store → 任何字段变化都重渲染
const state = useStore();
// state.currentView, state.tasks, state.aiConfig... 任何变化都重渲染

// ✅ 精确选择需要的字段
const currentView = useStore(s => s.currentView);
// 只有 currentView 变化时才重渲染
```

**底层实现**（简化版）：

```typescript
function create(createState) {
  let state = createState(set, get);
  const listeners = new Set();  // 订阅者集合

  function set(partial) {
    state = { ...state, ...partial };
    listeners.forEach(fn => fn());  // 通知所有订阅者
  }

  function useStore(selector) {
    const [, forceUpdate] = useReducer(x => x + 1, 0);
    const prev = useRef(selector(state));

    useEffect(() => {
      const listener = () => {
        const next = selector(state);
        if (!Object.is(prev.current, next)) {  // 值变了
          prev.current = next;
          forceUpdate();  // 触发重渲染
        }
      };
      listeners.add(listener);
      return () => listeners.delete(listener);
    }, []);

    return selector(state);
  }

  return useStore;
}
```

关键点：
1. 每个 `useStore(selector)` 调用都注册一个 listener
2. `set()` 时遍历所有 listener → 调用 selector → 用 `Object.is` 比较新旧值
3. 只有值变了的组件才调用 `forceUpdate()`（触发 React 重渲染）

### 持久化（localStorage 与 Zustand 集成）

```typescript
// App.tsx
useEffect(() => {
  const unsub = useStore.subscribe((state) => {
    localStorage.setItem('ordoflow-data', JSON.stringify({
      root: state.root,
      inbox: state.inbox,
      dependencies: state.dependencies,
    }));
  });
  return unsub; // cleanup: 组件卸载时取消订阅
}, []);
```

`useStore.subscribe` 监听整个 store 的每次变化。每次变化都序列化整棵树到 localStorage。Zustand 的 `subscribe` 与 React 的渲染循环是独立的 — 它不会触发重渲染，只在回调中写 localStorage。

---

## 9. React 深度原理

### React 组件是什么

React 组件 = **返回 JSX 的函数**。JSX 编译后变成 `React.createElement()` 调用：

```typescript
function Greeting({ name }: { name: string }) {
  return <h1>Hello, {name}</h1>;
}
// 编译后：
function Greeting({ name }) {
  return React.createElement('h1', null, 'Hello, ', name);
}

// 使用：
<Greeting name="Aster" />
// 编译后：
React.createElement(Greeting, { name: "Aster" })
```

### Hooks：函数的"记忆"

React 函数组件本身是无状态的。每次渲染都是**新调用**。Hooks 给函数组件加上跨渲染的记忆。

#### `useState` — 状态记忆

```typescript
function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}
```

**底层原理**：React 为每个组件维护一个**Fiber Node**（链表结构）。Fiber Node 上有一个 `memoizedState` 字段，存储该组件所有 hooks 的状态。

```
Counter 组件的 Fiber Node:
  memoizedState: Hook {
    memoizedState: 0,     ← 当前 useState(0) 的值
    queue: {              ← 待处理的更新队列
      pending: Update {   ← setCount(count + 1) 加入的更新
        action: fn,
        next: null
      }
    },
    next: null            ← 下一个 hook（没有）
  }
```

当 `setCount(count + 1)` 被调用时：
1. `setCount` 把更新加入 Hook 的 queue
2. React 调度一次重新渲染（异步批量处理 — 如果有多个 `setState`，React 会合并它们）
3. 渲染时，从 queue 中取出所有更新，逐个应用，得到最新值赋给 `count`
4. 新 Virtual DOM 与旧 Virtual DOM Diff → 只更新变化的 DOM

**为什么用数组解构 `[a, setA]`？** React 通过 hooks 的**调用顺序**匹配状态。不能在条件语句中调用 hooks，因为这会打破匹配。

```typescript
// ❌ 条件调用 hooks — 错误
if (condition) {
  const [a, setA] = useState(0);  // 有时这个 hook 存在，有时不存在
}
const [b, setB] = useState(0);    // b 的索引会变！
// React 把 a 的状态赋值给 b → bug!
```

#### `useEffect` — 副作用

```typescript
useEffect(() => {
  // 1. 渲染完成后执行（异步，不阻塞浏览器绘制）
  const timer = setInterval(() => {}, 1000);

  return () => {
    // 2. cleanup 函数：
    //    - 下次 effect 执行前
    //    - 组件卸载前
    clearInterval(timer);
  };
}, [dep1, dep2]);  // 依赖数组：只有这些值变才重新执行
```

**执行顺序**：
1. 挂载（首次渲染）→ effect 执行
2. 依赖变化 → 先执行旧 effect 的 cleanup → 再执行新 effect
3. 卸载 → 执行 cleanup

**`[]` 空依赖** = "只在挂载时执行一次"（componentDidMount 的等价物）。

`useEffect` 回调是**异步**的（微任务）。如果需要同步执行（在浏览器绘制前），用 `useLayoutEffect`。

#### `useMemo` — 缓存计算结果

```typescript
const layers = useMemo(
  () => getLayers(siblings, dependencies),  // 昂贵的计算
  [siblings, dependencies]                  // 只有这些变了才重新计算
);
```

**原理**：React 在 Fiber Node 上存储上次的依赖数组和计算结果。每次渲染时用 `Object.is` 比较新旧依赖。只有依赖变了才重新调用函数。

**注意**：`useMemo` 是性能优化，不是语义保证。React 在未来可能"忘记"缓存并重新计算。所以 `useMemo` 包裹的函数必须是纯函数（无副作用）。

#### `useCallback` — 缓存函数引用

```typescript
const handleClick = useCallback(
  () => doSomething(id),
  [id]
);
// 等价于 useMemo(() => () => doSomething(id), [id])
```

**为什么需要？** 普通函数每次渲染都是新引用（`===` 不相等）。如果传给 `React.memo` 包裹的子组件作为 prop，新引用会导致子组件无意义地重渲染。

#### `useRef` — 跨渲染的可变引用

```typescript
const inputRef = useRef<HTMLInputElement>(null);
// inputRef.current → DOM 元素
// 修改 .current 不触发重渲染
```

`useRef` 和 `useState` 的关键区别：`ref.current` 的修改**不触发重渲染**。适合存储 DOM 引用、前值引用、或任何需要"闭包里面拿到最新值"的场景。

#### `memo` — 跳过不必要的重渲染

```typescript
function TaskItem({ task, isLocked }: Props) { ... }
export default memo(TaskItem);
```

`memo` 对 props 做**浅比较**（`Object.is` 比较每个 prop）。父组件重渲染时，如果传给 `TaskItem` 的 props 没变，`TaskItem` 跳过渲染。

**注意**：如果 prop 是内联对象 `{ x: 1 }` 或内联函数 `() => something()`，每次渲染都是新引用，`memo` 无效。这就是为什么需要 `useCallback` 和 `useMemo` 来稳定引用。

### React 渲染循环

```
1. Trigger Phase（触发阶段）
   · setState / set()  / context 变化 / parent 重渲染
      ↓
2. Render Phase（渲染阶段 — 可中断，React 18 Concurrent Mode）
   · 递归调用组件函数
   · 返回新 Virtual DOM（Fiber Tree）
   · 用 Diff 算法对比新旧 Fiber Tree
   · 标记需要修改的 DOM 操作（增/删/改/移）
   · 此阶段可被高优先级更新（如用户输入）中断
      ↓
3. Commit Phase（提交阶段 — 不可中断）
   · 把标记的 DOM 操作应用到真实 DOM
   · 同步调用 useLayoutEffect
   · 浏览器执行 Layout（重排）和 Paint（重绘）
      ↓
4. Effect Phase（副作用阶段）
   · 异步调用 useEffect
   · 浏览器有剩余时间 → 执行
```

### Diff 算法（Reconciliation）

React 不比较两棵完整的 Virtual DOM 树（O(n³)）。它用启发式算法做到 O(n)：

**1. 同层比较（Tree Diff）**
```
Level 0: [div](#100) vs [div](#200) → 同类型 → 继续比较子节点
Level 1: [h1, p] vs [h1, span]     → h1 相同，p→span 类型不同 → 替换
```
React 只比较同一层级的节点。不跨层级比较。

**2. 类型比较（Component Diff）**
```
<div> → <span> → 类型变了 → 直接删除旧的 div（及整个子树），
                       创建新的 span
<Board> → <TaskList> → 组件类型变了 → 卸载 Board，挂载 TaskList
```

**3. Key 属性（Element Diff）**
```tsx
// 没有 key — React 按 index 对比
[<div>A</div>, <div>B</div>]
[<div>B</div>, <div>A</div>]
// React 认为：第一个 div 的文本从 A 变成了 B → 更新
//            第二个 div 的文本从 B 变成了 A → 更新
// 结果：2 次 DOM 更新（不必要）

// 有 key — React 按 key 对比
[<div key="a">A</div>, <div key="b">B</div>]
[<div key="b">B</div>, <div key="a">A</div>]
// React 认为：key="b" 从位置 2 移到了位置 1 → 移动 DOM
//            key="a" 从位置 1 移到了位置 2 → 移动 DOM
// 结果：0 次 DOM 更新，2 次移动（高效）
```

**结论**：列表渲染必须用**稳定、唯一的 key**（`task.id`），不能用 `index`。

### React 18 StrictMode

```tsx
<React.StrictMode>
  <App />
</React.StrictMode>
```

开发环境下，StrictMode 会**双重调用**组件函数体、useState 初始化函数、useReducer 的 reducer。

**目的**：检测副作用是否"纯"。如果组件依赖于"effect 只执行一次"的假设（如 API 调用），但在 StrictMode 下 effect 执行了两次而不清理 — 说明有 bug。

**注意**：只在开发模式下（`process.env.NODE_ENV === 'development'`）生效。生产构建不受影响。

---

## 10. React Flow：节点图渲染

### 什么是 React Flow

React Flow 处理图形渲染中最复杂的部分（浏览器兼容性、事件处理、贝塞尔曲线计算）：

- **节点拖拽** — pointer events 跨浏览器兼容
- **画布缩放/平移** — CSS transform matrix 计算
- **边缘连接** — 从 Handle 拖出贝塞尔曲线到另一个 Handle
- **选择** — 框选、多选、键盘 Delete 删除
- **Minimap** — 实时缩略图导航

### 从数据到画面

```
OrdoFlow Data → React Flow Props → SVG Canvas → Screen

Task[]  →  Node[]   { id, type, position, data }
Dependency[] → Edge[]  { id, source, target, animated, style }
↓
<ReactFlow nodes={nodes} edges={edges} ... />
↓
React Flow 内部：
  · 创建 SVG viewport（transform: matrix(scale, translate)）
  · 为每个 Node 创建 <div style={position}>（绝对定位在 viewport 内）
  · 为每个 Edge 创建 SVG <path>（贝塞尔曲线）
  · 监听 pointer/mouse 事件 → 处理拖拽/缩放/连接
```

### useNodesState / useEdgesState

```typescript
const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[]);
const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);
```

这两个 hooks 返回的数组解构：
- **`nodes`** — 当前节点数组（本地状态，React Flow 内部管理）
- **`setNodes`** — 直接替换节点数组
- **`onNodesChange`** — 事件处理器，传给 ReactFlow 的 `onNodesChange` prop

React Flow 在内部事件中调用 `onNodesChange`（用户拖拽节点时）：

```typescript
// React Flow 内部（简化）
function handlePointerMove(e) {
  const changes = nodes.map(n => {
    if (n.selected) return { type: 'position', id: n.id, position: calculatePosition(e, n), dragging: true };
    return null;
  }).filter(Boolean);
  onNodesChange(changes);  // → 更新本地节点状态
}
```

### Handle — 连接点

```tsx
<Handle type="target" position={Position.Left}  className="graph-handle" />
<Handle type="source" position={Position.Right} className="graph-handle" />
```

Handle 是 React Flow 提供的特殊组件。它的位置由 `position` prop 决定（相对父节点边缘）。从 source handle 拖出连线到 target handle → 触发 ReactFlow 的 `onConnect` 回调。

### 画布平移控制

```tsx
<ReactFlow
  panOnDrag={[0, 1, 2]}      // 左键、中键、右键都可以拖动画布
  zoomOnScroll={true}         // 滚轮缩放
  selectNodesOnDrag={false}   // 拖拽时不自动选择节点
>
```

`panOnDrag={[0, 1, 2]}` 中的数字对应 `MouseEvent.button`：
- 0 = 左键
- 1 = 中键（滚轮按下）
- 2 = 右键

### Canvas 组件的自动布局

```typescript
// 用拓扑排序结果计算节点位置
let autoX = 40;
for (const layer of layers) {
  let autoY = 40;
  for (const task of layer) {
    const pos = (task.position.x > 0 || task.position.y > 0)
      ? task.position        // 用户拖拽过 → 用存储的位置
      : { x: autoX, y: autoY };  // 新任务 → 自动布局
    nodes.push({ id: task.id, type: 'taskNode', position: pos, data: task, draggable: true });
    autoY += NODE_HEIGHT + NODE_GAP;
  }
  autoX += NODE_WIDTH + LAYER_GAP;
}
```

**自动布局策略**：Layer N 在 x = 40 + N*(180+120)。同一层的节点垂直排列，间距 60+20。

**用户拖拽后**：`task.position.x > 0` 判断是否被手动拖拽过。如果是，使用存储的位置。这避免了每次重渲染都重新布局。

---

## 11. AI 集成

### Provider 抽象层

```typescript
export type AIProvider = 'openai' | 'anthropic' | 'deepseek' | 'custom';

export async function callAI(config: AIConfig, userMessage: string): Promise<string> {
  if (config.provider === 'anthropic') {
    return callAnthropic(config, userMessage);   // Anthropic Messages API
  }
  return callOpenAICompatible(config, userMessage); // OpenAI / DeepSeek / Custom
}
```

**策略模式**：根据 provider 分发到不同的实现。`openai`、`deepseek`、`custom` 都走 OpenAI-compatible 的格式。`anthropic` 有自己的 API。

### OpenAI-Compatible API 调用

```typescript
async function callOpenAICompatible(config: AIConfig, userMessage: string): Promise<string> {
  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,       // ← Bearer token 认证
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },   // ← 系统提示词
        { role: 'user',   content: userMessage },     // ← 用户输入
      ],
    }),
  });
  const data = await res.json();
  return data.choices[0].message.content;
}
```

### Anthropic Messages API

```typescript
async function callAnthropic(config: AIConfig, userMessage: string): Promise<string> {
  const res = await fetch(`${config.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,                      // ← 用 x-api-key 头
      'anthropic-version': '2023-06-01',               // ← 必须指定 API 版本
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,                           // ← system 是顶层字段
      messages: [{ role: 'user', content: userMessage }],
    }),
  });
  const data = await res.json();
  return data.content[0].text;                         // ← 不同的响应格式
}
```

**两种 API 的关键区别**：

| | OpenAI | Anthropic |
|---|---|---|
| 认证头 | `Authorization: Bearer <key>` | `x-api-key: <key>` |
| System message | `messages[0].role: 'system'` | 顶层 `system` 字段 |
| 响应格式 | `data.choices[0].message.content` | `data.content[0].text` |
| Streaming | SSE 事件 | SSE 事件（格式不同） |
| Tool calling | function_call + parameters | tool_use content block |

### 提示词工程

```typescript
const SYSTEM_PROMPT = `Break down a goal into tasks with dependencies.

Return JSON:
{
  "tasks": [{ "title": "...", "estimatedMinutes": N, "energyLevel": "high|medium|low" }],
  "dependencies": [{ "from": "...", "to": "..." }]
}

Rules:
- No cycles in dependencies
- Task titles must be unique
- Only return JSON, no markdown fences`;
```

**提示词设计要点**：

1. **结构化输出** — `Return JSON:` 告诉 AI 以 JSON 格式返回，便于代码解析
2. **约束条件** — `No cycles` 防止 AI 生成逻辑矛盾的依赖关系
3. **无格式指令** — `no markdown fences` 防止 AI 用 \`\`\`json 包裹响应（常见错误）
4. **上下文注入** — 请求中拼入现有项目列表，让 AI 了解当前环境

### 响应解析

```typescript
export function parseAIResponse(raw: string): AIParsedResponse {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    // 去掉 markdown 代码块标记（AI 可能仍然加了）
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  return JSON.parse(cleaned);
}
```

**防御式解析**：即使提示词说了"不要加 markdown fences"，AI 仍可能加。`parseAIResponse` 做兼容处理。

### AI 确认流程（Toolbar 中的两阶段交互）

```
Step 1: 用户输入 "Plan a conference and submit it"
Step 2: 弹出确认 Modal
         · Target Project: dropdown (Create new / Inbox / existing projects)
         · Granularity: High (3-5) / Medium (6-12) / Detailed (15-25)
Step 3: 用户点击 "Generate"
         · 检查目标项目：如果是 "Create new"，先 `addTopLevelTask()`
         · 如果选择了 "Inbox" 且任务数>2，仍创建新 project（Inbox 不适合大项目）
Step 4: 调用 callAI → 解析 JSON → 逐个 addSubtask → addDependency
Step 5: 导航到创建的项目
```

---

## 12. URL 路由

### 为什么不用 react-router

OrdoFlow 只有两条路由（`/` 和 `/project/<id>`）。react-router 对于这个需求是过度的。

### 浏览器 History API 直接实现

```typescript
// 导航时更新 URL
goToBoard: () => {
  window.history.pushState(null, '', '/');         // 修改 URL 栏
  set({ currentView: 'board', ... });             // 更新 UI 状态
},

goToProject: (id) => {
  window.history.pushState(null, '', `/project/${id}`);
  set({ currentView: 'project', currentProjectId: id, ... });
},
```

`pushState` 修改地址栏但**不引起页面刷新**。浏览器继续运行当前的 SPA。

### 监听后退/前进

```typescript
window.addEventListener('popstate', () => {
  const { view, projectId } = parsePath(window.location.pathname);
  if (view === 'project' && projectId) {
    goToProject(projectId);  // 后退到某个 project
  } else {
    goToBoard();             // 后退到 Board
  }
});
```

`popstate` 在用户点击浏览器后退/前进按钮时触发。

### 初始化时恢复状态

```typescript
// App.tsx
useEffect(() => {
  const { view, projectId } = parsePath(window.location.pathname);
  if (view === 'project' && projectId) {
    goToProject(projectId);
    window.history.replaceState(null, '', `/project/${projectId}`);
    // ↑ replaceState 替换当前历史记录，不新增
  }
}, []);
```

**重要**：`pushState` 添加新历史记录；`replaceState` 替换当前记录。初始化时用 `replaceState` 避免创建一个重复的 history entry。

### `parsePath` — 保守的路径解析

```typescript
function parsePath(path: string): { view: 'board' | 'project'; projectId: string | null } {
  const match = path.match(/^\/project\/(.+)$/);
  if (match) return { view: 'project', projectId: decodeURIComponent(match[1]) };
  return { view: 'board', projectId: null };
}
```

`decodeURIComponent` 是必要的：如果 task ID 包含特殊字符（实际是 nanoid，不会），URL 中的百分号编码会被还原。

---

## 13. Tailwind CSS 样式系统

### 原子化 CSS vs 传统 CSS

**传统**：
```css
.card { padding: 1rem; background: white; border-radius: 0.5rem; }
.subtitle { font-size: 0.875rem; color: #555; }
```

```tsx
<div className="card"><p className="subtitle">...</p></div>
```

**Tailwind**：
```tsx
<div className="p-4 bg-white rounded-lg">
  <p className="text-sm text-gray-600">...</p>
</div>
```

**Tailwind 的优势**：
1. 所有样式都在 JSX 中可见 — 不需要在 CSS 文件和组件文件间跳转
2. 无命名冲突 — 不需要 BEM（`block__element--modifier`）约定
3. 生产构建 tree-shaking — Tailwind 自动删除未使用的 class
4. 约束性设计 — `text-sm`、`p-4` 这些预定义值确保了设计一致性

### CSS 变量 — 双主题系统

```css
:root {
  --bg-primary: #f3f0ea;    /* 暖奶油色 — 来自 blog.asters.codes */
  --bg-secondary: #eae6de;
  --bg-card: #ffffff;
  --text-primary: #1a1a1a;
  --text-secondary: #555555;
  --accent: #4a6741;       /* 橄榄绿 */
  --accent-hover: #3d5636;
  --danger: #a04040;
  --border: #d5d0c8;
  --radius: 3px;
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
  --shadow-md: 0 2px 8px rgba(0,0,0,0.06);
}

[data-theme="dark"] {
  --bg-primary: #11161c;    /* 深蓝灰 */
  --bg-secondary: #181d25;
  --bg-card: #1e2430;
  --text-primary: #d8d4cc;
  --accent: #7a9a6a;       /* 更亮的橄榄绿 */
  /* ... */
}
```

**CSS 变量的核心优势**：改变 `data-theme` 属性，所有使用变量的样式自动切换。不需要重写 class、不需要 JavaScript 更新每个元素的 style。

在组件中直接使用：
```css
.task-item { background: var(--bg-card); border-color: var(--border); }
.task-item:hover { background: var(--accent-light); }
```

### 排版

```css
html, body {
  font-family: 'EB Garamond', Georgia, serif;  /* 正文字体：优雅的衬线 */
  font-size: 16px;
}

code, .mono {
  font-family: 'JetBrains Mono', monospace;    /* 等宽字体：代码/数字 */
}
```

双字体策略：
- EB Garamond — 正文。经典的 Garamond 衬线字体，适合长时间阅读
- JetBrains Mono — 等宽。连字（ligatures）支持，代码/数字的现代感

---

## 14. 完整组件树

```
App (根组件)
 │
 ├─ Toolbar (固定顶栏, height: 48px, z-index: 40)
 │   ├─ 左侧: Logo (⚡ OrdoFlow) + ← 返回按钮
 │   ├─ 中央: AI 输入框 + "Break Down" 按钮
 │   ├─ 右侧: List/Graph 切换 + Settings 按钮 + 任务数
 │   ├─ AI 确认 Modal (目标项目选择 + 粒度选择)
 │   └─ Settings Modal (Provider/API Key/Base URL/Model)
 │
 ├─ main (主体, flex: 1, padding-top: 48px 让出工具栏位置)
 │   │
 │   ├─ [currentView === 'board']
 │   │   └─ Board
 │   │       ├─ Inbox 区域 (📥)
 │   │       │   ├─ 标题 (可点击 → 进入 Inbox 详情)
 │   │       │   └─ 最多显示 5 个 item，超过显示 "+N more"
 │   │       └─ Projects 区域 (📦)
 │   │           ├─ 列表项: 项目名 + 剩余任务数 + ✎(编辑) + ×(删除)
 │   │           └─ "+ New Project" 按钮 (虚线边框)
 │   │
 │   └─ [currentView === 'project']
 │       │
 │       ├─ [viewMode === 'list']
 │       │   └─ TaskList
 │       │       ├─ QuickAdd (输入框 + Add 按钮, 按 / 聚焦)
 │       │       ├─ 选择工具栏 (Select / Delete(N) / Cancel)
 │       │       └─ LayerSection[] (每层)
 │       │           ├─ Layer 标题 + 排序下拉 (Manual | Priority | Deadline | Duration | Energy)
 │       │           └─ TaskItem[] (每个任务)
 │       │               ├─ 复选框 (🔒 锁定 / ✓ 完成 / ○ 待办)
 │       │               ├─ 标题 (单击 → 详情 / 双击 → 内联编辑)
 │       │               ├─ 能量标记 ⚡🟡🟢
 │       │               ├─ 进度条 (有子任务时: ████░░ 2/5)
 │       │               ├─ 预计耗时 (叶子任务)
 │       │               ├─ 🔒 图标 (被阻塞)
 │       │               └─ 🚩 图标 (关键路径)
 │       │
 │       └─ [viewMode === 'graph']
 │           └─ Canvas
 │               ├─ ReactFlow
 │               │   ├─ TaskNode[] (自动布局左→右, 同层垂直堆叠)
 │               │   │   ├─ Handle (左右连接点)
 │               │   │   ├─ 标题 (双击编辑)
 │               │   │   └─ 进度条 + 能量 + 耗时
 │               │   ├─ Edge[] (依赖线: pending→虚线/动画, done→实线)
 │               │   ├─ Background (点状网格, 24px 间距)
 │               │   ├─ Controls (缩放+/-, 适应画面, 锁定)
 │               │   └─ MiniMap (缩略图, 右下角)
 │               └─ 空状态: "Use the list view to add tasks first"
 │
 ├─ [selectedTaskId 存在]
 │   └─ DetailPanel (右侧滑出面板, width: 360px, z-index: 50)
 │       ├─ 标题栏 + × 关闭按钮
 │       ├─ 表单: Title / Description / Est. Minutes / Deadline
 │       ├─ AI Refine 按钮 (est ≥ 60min + 无子任务 + 已配 API key)
 │       ├─ Priority 选择 (Pinned / High / Medium / Low)
 │       ├─ Energy Level (⚡High / 🟡Medium / 🟢Low)
 │       ├─ Status (Pending / In Progress / Done)
 │       ├─ Progress 区域 (有子任务时: 进度条 + % + 剩余时间)
 │       ├─ Sub-tasks 列表
 │       │   ├─ 子任务项 (复选框 + 标题)
 │       │   └─ "Add sub-task..." 输入框
 │       ├─ Dependencies 区域
 │       │   ├─ ← 阻塞我的任务 (可删除)
 │       │   └─ → 我阻塞的任务 (可删除)
 │       ├─ Add Dependency 下拉 (选择框 + Add 按钮)
 │       └─ Delete Task 按钮 (红色, 底部)
 │
 └─ ToastContainer (固定顶部居中, z-index: 60)
     └─ Toast[] (错误/信息, 3秒自动消失, 渐入动画)
```

### 数据流

```
用户操作 (点击/拖拽/输入)
  ↓
组件调用 store.action()
  ↓
Zustand set({ ... }) — 不可变更新 state

  ├─→ localStorage (useStore.subscribe 回调) — 持久化
  └─→ 通知所有订阅者 (listener)
       ↓
      选择器 selector(s) 的值变了？
       ├─ 是 → React 重渲染该组件
       └─ 否 → 跳过
       ↓
      组件返回新 Virtual DOM
       ↓
      React Diff 算法 → 更新真实 DOM
       ↓
      浏览器重绘
```

---

## 15. Code Review

### 做得好的方面

#### 1. 数据模型极简

`Task { subtasks: Task[] }` 一个递归类型代替了 Project/Folder/parentId 三个概念。概念更少 → 认知负担更低 → bug 更少。

#### 2. 纯函数与副作用严格分离

`@ordoflow/core` 的所有函数都是**纯函数**（无副作用）。所有副作用（localStorage、API 调用、DOM 操作）都在 `@ordoflow/web` 中。这使 core 包可以单独测试且无环境依赖（19 个测试全是纯逻辑测试）。

#### 3. 不可变更新正确实现

`updateTaskInTree`、`removeTaskFromTree`、`addSubtaskToTree` 都返回新对象，不修改原对象。React 的引用比较能正确检测变化。

#### 4. Zustand 选择器精确订阅

```typescript
const currentView = useStore(s => s.currentView);  // ← 精确
// 而不是
const state = useStore();  // ← 订阅一切
```

#### 5. 算法代码可读

`getLayers` 的注释和算法步骤一一对应。`wouldCreateCycle` 的 DFS 逻辑清晰。

### 可以改进的方面

#### 1. localStorage 全量序列化（性能）

每次 store 变化都 `JSON.stringify` 整棵树。对 100+ 任务的项目会产生明显卡顿。

**建议方案**：
- 用 `requestIdleCallback` 延迟写入（浏览器空闲时才写）
- 用 IndexedDB（dexie.js）代替 localStorage，支持增量更新
- 用 throttle（节流）限制写入频率

#### 2. 自动布局后手动位置判断不精确

```typescript
const pos = (task.position.x > 0 || task.position.y > 0)
  ? task.position : autoPos;
```

如果用户拖拽到负坐标附近，条件失效，任务会跳回自动布局位置。

**建议**：用 `manuallyPositioned: boolean` 标记替代位置判断。

#### 3. Toast 通过 CustomEvent 解耦

```typescript
window.dispatchEvent(new CustomEvent('ordoflow-toast', { detail }));
```

这是灵活的模式（组件间解耦），但：
- 无类型安全（`detail` 是 `any`）
- 不可追踪调用链
- 全局单例

**建议**：把 toast 放到 Zustand store：

```typescript
interface State {
  toasts: Toast[];
  addToast: (msg, type) => void;
}
```

#### 4. 环检测→优雅降级

```typescript
if (visitedCount < siblings.length) return [siblings]; // 返回原数组
```

向用户展示警告比静默降级更好。

#### 5. `handleNodesChange` 中 `dragging === false` 判断

只在拖拽结束时写 store。如果 React Flow 在拖拽中被数据刷新重置，节点位置丢失。

---

## 16. 与其他框架对比

### Vue 3 — 响应式系统

Vue 的核心优势是**响应式**（reactive）。修改数据自动追踪依赖。

```typescript
// Vue 3 — 响应式修改
const state = reactive({ count: 0 });
state.count++;  // Vue 自动追踪 → 触发 UI 更新
```

```typescript
// React — 不可变更新
const [count, setCount] = useState(0);
setCount(count + 1);  // 显式调用 setter
```

**Vue 怎么做 OrdoFlow 的任务树？**

Vue 的 `reactive` 可以包裹整个嵌套对象。修改深层任务会自动触发更新。但 Vue 的 Reactivity 有边界条件（Map、Set 需要特殊处理），而 React 的不可变模型更简单直接。

| | React | Vue 3 |
|---|---|---|
| 更新机制 | 不可变（创建新对象） | Proxy 响应式（直接修改） |
| 渲染粒度 | 组件级（Virtual DOM diff） | 组件级 + 编译器优化（模板静态提升） |
| 状态管理 | Zustand / Redux | Pinia |
| TypeScript | 一等支持 | 良好（但有模板限制） |
| 学习曲线 | 陡（JSX、hooks、闭包） | 平（模板接近 HTML） |

### Svelte — 编译时魔法

Svelte 没有 Virtual DOM。编译器在**构建时**把组件转成高效的 DOM 操作代码。

```svelte
<script>
  let count = 0;
</script>
<button on:click={() => count += 1}>{count}</button>
```

编译后的代码 ≈ `button.textContent = count;` — 直接操作 DOM。

Svelte 5 引入了**符文**（runes）— 类似 SolidJS 的信号：

```svelte
<script>
  let count = $state(0);  // ← 符文语法
</script>
```

| | React | Svelte |
|---|---|---|
| 运行时 | Virtual DOM + diff | 编译时生成 DOM 操作代码 |
| 包大小 | ~40KB (react-dom) | ~2KB |
| 响应式 | 显式 setState | 赋值即更新 |
| 生态 | 最大 | 快速增长 |

### SolidJS — 精确定向更新

SolidJS 和 React 语法几乎一样，但**没有 Virtual DOM**。

```tsx
function Counter() {
  const [count, setCount] = createSignal(0);
  // createSignal 返回 [getter, setter]，不是 [value, setter]

  return <button onClick={() => setCount(count() + 1)}>{count()}</button>;
  // JSX 中用 getter 函数调用，不是变量
}
```

核心差异 — **组件函数只执行一次**：

```tsx
// React — 每次状态变化都重执行
function MyComp() {
  const [count, setCount] = useState(0);
  console.log('re-render');  // 每次 setCount 都打印
  return <div>{count}</div>;
}

// SolidJS — 只执行一次
function MyComp() {
  const [count, setCount] = createSignal(0);
  console.log('only once');  // 只打印一次
  return <div>{count()}</div>;  // 值绑定在编译时处理
}
```

| | React | SolidJS |
|---|---|---|
| 组件函数调用 | 每次 state 变化 | 只执行一次 |
| 更新粒度 | 组件级 | DOM 节点级 |
| 性能 | 好（VDOM 优化） | 极好（无 VDOM） |
| 心智模型 | "状态 → 快照" | "状态 → 细粒度依赖追踪" |
| React 生态兼容 | — | 部分兼容（React Hook 不可用） |

### 为什么 OrdoFlow 选 React

1. **React Flow 库** — 目前最好的流程图渲染库，只有 React 版本
2. **Zustand** — 最简洁的状态管理，与 React 完美集成
3. **生态** — 组件、工具链、社区资源最丰富
4. **适用性** — 如果将来需要把 OrdoFlow 做成 Electron 桌面应用，React 有成熟的方案
