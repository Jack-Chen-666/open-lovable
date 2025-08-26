-- Workspace 项目数据库结构初始化脚本
-- 根据 WORKSPACE_ARCHITECTURE.md 创建所有必要的表和存储桶

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

-- 注释：Storage buckets 需要在 Supabase Dashboard 中手动创建
-- 或通过 Supabase 管理 API 创建：
-- 1. project-zips (用于存储项目 ZIP 快照)
-- 2. project-screenshots (用于存储预览截图)
