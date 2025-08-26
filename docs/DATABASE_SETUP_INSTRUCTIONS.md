# 数据库设置说明

## 概述
本文档提供了在 Supabase 中设置 Workspace 功能所需数据库表和存储桶的详细说明。

## 前置条件
- 已有 Supabase 项目：`https://qutmwznbbypvpurqtmvx.supabase.co`
- 项目的 service_role 密钥可用

## 设置步骤

### 1. 登录 Supabase Dashboard
访问：https://supabase.com/dashboard/project/qutmwznbbypvpurqtmvx

### 2. 创建数据库表

在 Supabase Dashboard 中，进入 "SQL Editor" 并执行以下 SQL 脚本：

```sql
-- 启用 UUID 扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- projects: 项目元数据
CREATE TABLE IF NOT EXISTS public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private', -- private | public
  model TEXT NOT NULL DEFAULT 'moonshotai/kimi-k2-instruct',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_opened_at TIMESTAMPTZ
);

-- project_state: 运行态引用（当前沙箱等）
CREATE TABLE IF NOT EXISTS public.project_state (
  project_id UUID PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  sandbox_id TEXT,           -- 最近一次可用的 E2B sandboxId
  sandbox_url TEXT,          -- 最近一次预览 URL
  sandbox_started_at TIMESTAMPTZ,
  sandbox_expires_at TIMESTAMPTZ,
  last_snapshot_id UUID
);

-- project_snapshots: 快照列表（Zip 存储在 Storage，表里只存引用）
CREATE TABLE IF NOT EXISTS public.project_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL,       -- e.g. project-zips/{project_id}/{id}.zip
  size_bytes BIGINT,
  sha256 TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- project_manifests: 文件清单/解析结果缓存（用于加速重新打开）
CREATE TABLE IF NOT EXISTS public.project_manifests (
  project_id UUID PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  manifest JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_projects_visibility ON public.projects(visibility);
CREATE INDEX IF NOT EXISTS idx_projects_created_at ON public.projects(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_snapshots_project_id ON public.project_snapshots(project_id);
CREATE INDEX IF NOT EXISTS idx_project_snapshots_created_at ON public.project_snapshots(created_at DESC);

-- 创建更新时间的触发器函数
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 为 projects 表添加自动更新 updated_at 的触发器
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON public.projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 为 project_manifests 表添加自动更新 updated_at 的触发器
CREATE TRIGGER update_project_manifests_updated_at BEFORE UPDATE ON public.project_manifests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 设置 RLS（Row Level Security）
-- MVP 阶段先允许匿名访问用于开发，生产环境需要更严格的权限控制
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_manifests ENABLE ROW LEVEL SECURITY;

-- 创建允许匿名访问的策略（开发环境用）
CREATE POLICY "Allow anonymous access on projects" ON public.projects
  FOR ALL USING (true);

CREATE POLICY "Allow anonymous access on project_state" ON public.project_state
  FOR ALL USING (true);

CREATE POLICY "Allow anonymous access on project_snapshots" ON public.project_snapshots
  FOR ALL USING (true);

CREATE POLICY "Allow anonymous access on project_manifests" ON public.project_manifests
  FOR ALL USING (true);
```

### 3. 创建 Storage Buckets

在 Supabase Dashboard 中，进入 "Storage" 页面：

#### 创建 project-zips bucket
1. 点击 "Create a new bucket"
2. Bucket name: `project-zips`
3. Public bucket: **取消勾选** (私有)
4. 在 "Allowed mime types" 中添加：
   - `application/zip`
   - `application/x-zip-compressed`
5. File size limit: `104857600` (100MB)
6. 点击 "Create bucket"

#### 创建 project-screenshots bucket
1. 点击 "Create a new bucket"
2. Bucket name: `project-screenshots`
3. Public bucket: **勾选** (公开)
4. 在 "Allowed mime types" 中添加：
   - `image/png`
   - `image/jpeg`
   - `image/webp`
5. File size limit: `10485760` (10MB)
6. 点击 "Create bucket"

### 4. 验证设置

运行验证脚本来确认所有设置正确：

```bash
node scripts/test-database.js
```

期望的输出应该包含：
- ✅ Supabase 客户端初始化成功
- ✅ projects 表已存在
- ✅ project_state 表已存在
- ✅ project_snapshots 表已存在
- ✅ project_manifests 表已存在
- ✅ 所有必需的 Storage buckets 都已存在

## 故障排除

### 如果表创建失败
- 确认你有足够的权限执行 DDL 语句
- 检查是否有语法错误
- 确认使用了正确的 service_role 密钥

### 如果 Storage buckets 创建失败
- 确认 bucket 名称没有重复
- 检查权限设置
- 确认 MIME 类型格式正确

## 安全注意事项

当前配置为开发环境设置，允许匿名访问。生产环境中需要：

1. 更新 RLS 策略以限制访问
2. 实现用户身份验证
3. 为不同操作设置适当的权限控制

## 下一步

完成数据库设置后，可以继续执行：
- Task 1.3: TypeScript 类型定义
- Task 1.4: 项目 CRUD API 开发
