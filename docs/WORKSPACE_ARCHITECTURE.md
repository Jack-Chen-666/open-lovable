# Workspace 架构设计文档

## 目标与约束

- 在首页新增 Workspace：可创建/列出/打开/删除多个项目，二次进入可继续开发
- 项目需"长期可用"，运行态仍使用 E2B 临时沙箱；持久化交给 Supabase
- URL 不再暴露 `sandbox` 与 `model`，改为 `/:projectId` 的项目详情页

## 总体架构

### 持久层（Supabase）
- 表存"项目元数据 + 运行态引用 + 快照引用"
- Storage 存"项目 ZIP 快照""预览截图"
- RLS 控制访问（MVP 可先开放，再逐步收紧）

### 运行层（E2B 沙箱）
- 打开项目时：若记录的 `sandboxId` 可连则复用；否则新建沙箱并从快照还原
- 开发中仍写入沙箱文件系统；关键节点触发快照到 Supabase Storage

### 前端
- 首页 `Workspace`：项目卡片列表
- 详情页 `/projects/:projectId`：复用现有编辑 UI 和流式生成能力，不暴露内部 `sandboxId/model`

### 后端 API
- `projects` CRUD + `open`（确保沙箱可用）+ `snapshot`（打包并上传）+ `status`
- 现有 AI 路由改为基于 `projectId` 取沙箱/模型，不再从 URL 读

## 数据模型（Supabase SQL）

### 核心表结构（MVP）

```sql
-- projects: 项目元数据
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  visibility text not null default 'private', -- private | public
  model text not null default 'moonshotai/kimi-k2-instruct',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_opened_at timestamptz
);

-- project_state: 运行态引用（当前沙箱等）
create table if not exists public.project_state (
  project_id uuid primary key references public.projects(id) on delete cascade,
  sandbox_id text,           -- 最近一次可用的 E2B sandboxId
  sandbox_url text,          -- 最近一次预览 URL
  sandbox_started_at timestamptz,
  sandbox_expires_at timestamptz,
  last_snapshot_id uuid
);

-- project_snapshots: 快照列表（Zip 存储在 Storage，表里只存引用）
create table if not exists public.project_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  storage_key text not null,       -- e.g. project-zips/{project_id}/{id}.zip
  size_bytes bigint,
  sha256 text,
  created_at timestamptz not null default now()
);

-- 可选：文件清单/解析结果缓存（用于加速重新打开）
create table if not exists public.project_manifests (
  project_id uuid primary key references public.projects(id) on delete cascade,
  manifest jsonb not null,
  updated_at timestamptz not null default now()
);
```

### Storage Buckets
- `project-zips`：保存 ZIP
- `project-screenshots`：保存预览截图（可选）

### RLS（建议）
- MVP：先允许 `anon` 读/写开发用库（或关闭 RLS）
- 生产：根据 `owner_id` 精确授权
- 避免把 `service_role` 暴露到浏览器端

## 环境变量

```bash
# Supabase
SUPABASE_URL=https://qutmwznbbypvpurqtmvx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1dG13em5iYnlwdnB1cnF0bXZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYxNDIwNzcsImV4cCI6MjA3MTcxODA3N30.FjLOjG_0nr2Dzcd_gRkS56p6w8bILxiHCFcyW7-pTHk
SUPABASE_SERVICE_ROLE=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1dG13em5iYnlwdnB1cnF0bXZ4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NjE0MjA3NywiZXhwIjoyMDcxNzE4MDc3fQ.TdWnWQpQDpCDWfF4DTT-XJ5RT7G2ZqakCdyDFy4U9fQ
# 仅服务端 API 读取 SERVICE_ROLE；浏览器仅使用 ANON
```

## 新增/修改的代码模块与文件

### 新增 Supabase 客户端
- `lib/supabase/server.ts`：服务端 client（使用 `SUPABASE_SERVICE_ROLE`）
- `lib/supabase/client.ts`：浏览器端 client（使用 `SUPABASE_ANON_KEY`，仅少量只读）

### 类型
- `types/project.ts`：`Project`, `ProjectState`, `ProjectSnapshot`

### 新 API（Next.js Route Handlers）
- `app/api/projects/route.ts`（GET 列表 / POST 创建）
- `app/api/projects/[id]/route.ts`（GET 详情 / DELETE 删除 / PATCH 重命名）
- `app/api/projects/[id]/open/route.ts`（确保沙箱：可连则复用，失效则新建并还原快照）
- `app/api/projects/[id]/snapshot/route.ts`（打包 ZIP→上传 Storage→记录 snapshot）
- `app/api/projects/[id]/status/route.ts`（返回沙箱、预览、快照信息）
- `app/api/projects/[id]/clone-sandbox/route.ts`（临期热迁移：旧→新沙箱滚动切换）

### 路由与页面
- 首页 Workspace（替换/改造 `app/page.tsx`）：项目卡片列表 + 新建按钮
- 新增 `app/projects/[id]/page.tsx`：项目详情页（复用现有编辑/预览 UI，进入即调用 `open`）

### 现有 AI/开发相关 API 的适配
- `app/api/generate-ai-code-stream/route.ts`
- `app/api/analyze-edit-intent/route.ts`
- `app/api/apply-ai-code/route.ts`
- `app/api/apply-ai-code-stream/route.ts`
- 统一从 `projectId`（请求 body 或 header）解析：查询 `project_state.sandbox_id`→`Sandbox.connect`→若失效则走"自动恢复"（新建+快照还原）

## URL 方案（不暴露内部细节）

### 路由设计
- 首页 Workspace：`/`（项目卡片列表）
- 项目详情：`/projects/:projectId`（不再暴露 `sandbox`、`model`）

### 内部参数传递
- 前端需把"当前模型"移到 DB 字段 `projects.model`，由后端路由读取
- 所有内部 API 以 `projectId` 为上下文参数（body/header），不透出 `sandboxId`

## 打开项目流程（/projects/:id）

1. **前端进入详情页**：SSR 或首次 `useEffect` 调用 `POST /api/projects/:id/open`

2. **后端逻辑**：
   - 查 `project_state.sandbox_id`，尝试 `Sandbox.connect`
   - 若成功：刷新 `sandbox_url` 并返回
   - 若失败/不存在：
     - 新建 E2B 沙箱 → 如果存在最近快照：解压还原；否则创建基础 Vite 环境（可重用现有 `create-ai-sandbox` 逻辑）
     - `npm install` → `npm run dev` → 写回 `project_state`（`sandbox_id/url/started_at`）

3. **前端处理**：拿到 `url` 直接嵌入预览，编辑/AI 生成的 API 调用都带上 `projectId`

## 快照策略与"临期热迁移"

### 快照触发（三选其一或并用）
- **手动**："保存/快照"按钮 → `POST /api/projects/:id/snapshot`
- **自动**：在成功 `apply-ai-code` 后异步触发快照（防止频繁可做节流/队列）
- **定时**：例如每 5–10 分钟 + 只在有文件变化时上传

### 临期热迁移（滚动沙箱）
- **触发时机**：距离 `sandbox_expires_at` 剩 2–3 分钟
- **流程**：调用 `clone-sandbox`（旧沙箱打包→新沙箱解压→启动→切换指针→清理旧）
- **兜底**：也作为"打开项目但旧沙箱失效"的兜底流程

## 与现有代码的对接点（关键改造）

### URL 参数移除
- 将前端 URL 参数 `?sandbox=...&model=...` 去除，改从后端读取

### AI 路由适配
在上述 AI 路由中：
- 接收 `projectId`（优先）→ 从 Supabase 取 `model` 与 `sandbox_id`
- `global.activeSandbox` 依旧可用作本进程缓存，但每次请求都以 `projectId` 做权威检查、必要时 `Sandbox.connect`
- 写文件/获取文件清单仍走现有逻辑（路径 `/home/user/app` 不变）

### 导出 ZIP 复用
- 将 `/api/create-zip` 复用为 `projects/:id/snapshot` 的底层（然后把 base64 上传到 Supabase Storage）

## 安全与权限

### 密钥使用
- 浏览器端只使用 `ANON_KEY`
- 所有涉及沙箱与 Storage 写入的操作必须在服务端执行（使用 `SERVICE_ROLE`）

### RLS 策略（生产）
- `projects.visibility='public'` 可匿名读；其他仅 owner 可见（如需用户系统后续扩展 `owner_id`）
- 写操作仅 `service_role` 或经过认证的 owner

## 实施步骤（建议迭代）

### 第 1 步（数据与 API）
- 建表 + 创建 Storage buckets
- 新增 `projects` CRUD、`open`、`snapshot`、`status`、`clone-sandbox`

### 第 2 步（URL 与页面）
- 新增 `app/projects/[id]/page.tsx`；把现有编辑 UI 从 `app/page.tsx` 抽到可复用组件
- 首页改造成 Workspace 卡片列表（读 Supabase）

### 第 3 步（AI 路由适配）
- 统一以 `projectId` 为上下文，移除对 `?sandbox=&model=` 的依赖

### 第 4 步（体验与稳定性）
- 加入自动快照/热迁移策略
- 加入项目预览截图（调用已有截图路由→存到 Storage）
- 逐步开启 RLS

## 关键接口定义

### 项目管理
- `POST /api/projects` `{ name, model? }` → `{ id }`
- `GET /api/projects` → 项目列表
- `GET /api/projects/:id` → 项目详情
- `DELETE /api/projects/:id` → 删除项目
- `PATCH /api/projects/:id` `{ name?, model? }` → 更新项目

### 沙箱管理
- `POST /api/projects/:id/open` → 确保沙箱可用 `{ sandboxUrl }`
- `GET /api/projects/:id/status` → `{ sandboxId?, url?, lastSnapshot?, expiresAt? }`
- `POST /api/projects/:id/clone-sandbox` → 热迁移成功返回新 `sandboxUrl`

### 快照管理
- `POST /api/projects/:id/snapshot` → 生成快照并存储
- `GET /api/projects/:id/snapshots` → 快照列表

## 数据流示意

```
用户访问 /projects/abc-123
↓
前端调用 POST /api/projects/abc-123/open
↓
后端查询 project_state.sandbox_id
↓
尝试 Sandbox.connect(sandbox_id)
├─ 成功 → 返回现有 sandbox_url
└─ 失败 → 新建沙箱 → 从最新快照还原 → 启动 Vite → 更新 project_state
↓
前端获得 sandbox_url，加载预览
↓
用户编辑/AI 生成 → 调用现有 AI 路由（带 projectId）
↓
定期/手动触发快照 → 打包 ZIP → 上传 Supabase Storage
```

## 技术栈总结

- **前端**：Next.js 15 + React 19 + Tailwind CSS
- **后端**：Next.js API Routes + E2B Code Interpreter
- **数据库**：Supabase Postgres + Storage
- **实时环境**：E2B 临时沙箱
- **持久化**：ZIP 快照存储 + 项目元数据
- **路由**：动态路由 `/projects/[id]`

## 预期收益

1. **持久化**：项目不再受沙箱 15 分钟限制约束
2. **多项目**：用户可同时管理多个项目
3. **隐私**：URL 不暴露内部技术细节
4. **扩展性**：为后续用户系统、协作、版本管理等功能打下基础
5. **稳定性**：通过快照 + 热迁移提升可用性

