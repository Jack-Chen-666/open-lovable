/**
 * Workspace 项目相关的 TypeScript 类型定义
 * 对应 Supabase 数据库表结构
 */

/**
 * 项目基础信息
 * 对应 public.projects 表
 */
export interface Project {
  id: string
  name: string
  visibility: 'private' | 'public'
  model: string
  created_at: string
  updated_at: string
  last_opened_at?: string | null
}

/**
 * 项目运行状态
 * 对应 public.project_state 表
 */
export interface ProjectState {
  project_id: string
  sandbox_id?: string | null
  sandbox_url?: string | null
  sandbox_started_at?: string | null
  sandbox_expires_at?: string | null
  last_snapshot_id?: string | null
}

/**
 * 项目快照信息
 * 对应 public.project_snapshots 表
 */
export interface ProjectSnapshot {
  id: string
  project_id: string
  storage_key: string
  size_bytes?: number | null
  sha256?: string | null
  created_at: string
}

/**
 * 项目文件清单
 * 对应 public.project_manifests 表
 */
export interface ProjectManifest {
  project_id: string
  manifest: any // JSONB 类型，包含文件结构信息
  updated_at: string
}

/**
 * 创建项目请求接口
 */
export interface CreateProjectRequest {
  name: string
  model?: string
  visibility?: 'private' | 'public'
}

/**
 * 更新项目请求接口
 */
export interface UpdateProjectRequest {
  name?: string
  model?: string
  visibility?: 'private' | 'public'
}

/**
 * 项目列表响应接口
 */
export interface ProjectListResponse {
  projects: Project[]
  total: number
}

/**
 * 项目详情响应接口（包含状态信息）
 */
export interface ProjectDetailResponse extends Project {
  state?: ProjectState
  latest_snapshot?: ProjectSnapshot
}

/**
 * 项目打开响应接口
 */
export interface ProjectOpenResponse {
  project_id: string
  sandbox_id: string
  sandbox_url: string
  status: 'existing' | 'created' | 'restored'
  message?: string
}

/**
 * 项目状态查询响应接口
 */
export interface ProjectStatusResponse {
  project_id: string
  sandbox_id?: string | null
  sandbox_url?: string | null
  sandbox_status: 'running' | 'stopped' | 'expired' | 'unknown'
  expires_at?: string | null
  snapshots_count: number
  latest_snapshot?: ProjectSnapshot
}

/**
 * 快照创建响应接口
 */
export interface SnapshotCreateResponse {
  snapshot_id: string
  storage_key: string
  size_bytes: number
  sha256: string
  created_at: string
}

/**
 * 快照列表响应接口
 */
export interface SnapshotListResponse {
  snapshots: ProjectSnapshot[]
  total: number
}

/**
 * 沙箱克隆/迁移响应接口
 */
export interface SandboxCloneResponse {
  old_sandbox_id: string
  new_sandbox_id: string
  new_sandbox_url: string
  migration_duration: number
  status: 'success' | 'partial' | 'failed'
  message?: string
}

/**
 * API 错误响应接口
 */
export interface ApiErrorResponse {
  error: string
  message: string
  details?: any
  code?: string
}

/**
 * 通用 API 响应包装器
 */
export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: ApiErrorResponse
}

/**
 * 项目列表查询参数
 */
export interface ProjectListParams {
  page?: number
  limit?: number
  visibility?: 'private' | 'public' | 'all'
  sort_by?: 'created_at' | 'updated_at' | 'last_opened_at' | 'name'
  sort_order?: 'asc' | 'desc'
  search?: string
}

/**
 * 快照列表查询参数
 */
export interface SnapshotListParams {
  page?: number
  limit?: number
  sort_order?: 'asc' | 'desc'
}

/**
 * 沙箱状态枚举
 */
export enum SandboxStatus {
  RUNNING = 'running',
  STOPPED = 'stopped',
  EXPIRED = 'expired',
  UNKNOWN = 'unknown'
}

/**
 * 项目可见性枚举
 */
export enum ProjectVisibility {
  PRIVATE = 'private',
  PUBLIC = 'public'
}

/**
 * 支持的模型列表
 */
export const SUPPORTED_MODELS = [
  'moonshotai/kimi-k2-instruct',
  'anthropic/claude-3-sonnet',
  'openai/gpt-4',
  'openai/gpt-3.5-turbo'
] as const

export type SupportedModel = typeof SUPPORTED_MODELS[number]
