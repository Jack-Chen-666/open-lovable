# 沙箱管理 API 使用指南

## 概述

本文档介绍 Workspace 项目的沙箱管理 API，包括项目打开、快照管理、状态监控和热迁移功能。

## API 端点总览

### 项目基础管理
- `GET /api/projects` - 获取项目列表
- `POST /api/projects` - 创建新项目
- `GET /api/projects/{id}` - 获取项目详情
- `PATCH /api/projects/{id}` - 更新项目信息
- `DELETE /api/projects/{id}` - 删除项目

### 沙箱管理
- `POST /api/projects/{id}/open` - 打开项目（确保沙箱可用）
- `GET /api/projects/{id}/status` - 获取项目状态
- `POST /api/projects/{id}/status` - 执行状态操作（刷新/清理）
- `POST /api/projects/{id}/clone-sandbox` - 沙箱热迁移

### 快照管理
- `POST /api/projects/{id}/snapshot` - 创建项目快照
- `GET /api/projects/{id}/snapshot` - 获取快照列表

## 详细 API 说明

### 1. 项目打开 API

#### `POST /api/projects/{id}/open`

打开项目并确保沙箱环境可用。这是使用项目的第一步。

**功能说明:**
- 检查项目是否存在现有的可用沙箱
- 如果沙箱有效且未过期，直接返回连接信息
- 如果沙箱失效，创建新沙箱
- 如果有快照，从最新快照恢复项目文件
- 如果没有快照，创建基础 Vite 环境

**响应示例:**
```json
{
  "success": true,
  "data": {
    "project_id": "abc-123",
    "sandbox_id": "e2b_sandbox_xyz",
    "sandbox_url": "https://xyz.e2b.dev",
    "status": "restored", // existing | created | restored
    "message": "从快照恢复项目成功"
  }
}
```

**状态说明:**
- `existing`: 连接到现有沙箱
- `created`: 创建了新的基础环境
- `restored`: 从快照恢复了项目

### 2. 项目状态查询

#### `GET /api/projects/{id}/status`

获取项目的详细状态信息，包括沙箱健康状态和快照信息。

**响应示例:**
```json
{
  "success": true,
  "data": {
    "project_id": "abc-123",
    "sandbox_id": "e2b_sandbox_xyz",
    "sandbox_url": "https://xyz.e2b.dev",
    "sandbox_status": "running", // running | stopped | expired | unknown
    "expires_at": "2024-01-01T12:00:00Z",
    "snapshots_count": 3,
    "latest_snapshot": {
      "id": "snapshot-id",
      "storage_key": "project-zips/abc-123/snapshot-id.zip",
      "size_bytes": 1024000,
      "created_at": "2024-01-01T11:00:00Z"
    }
  }
}
```

#### `POST /api/projects/{id}/status`

执行状态相关操作。

**请求体:**
```json
{
  "action": "refresh" // refresh | cleanup | force_cleanup
}
```

**操作说明:**
- `refresh`: 重新检查项目状态
- `cleanup`: 清理过期的沙箱状态
- `force_cleanup`: 强制清理所有沙箱状态

### 3. 快照管理

#### `POST /api/projects/{id}/snapshot`

创建项目的当前状态快照。

**功能说明:**
- 在沙箱中创建项目文件的 ZIP 压缩包
- 上传到 Supabase Storage
- 记录快照元数据
- 自动清理旧快照（保留最近5个）

**响应示例:**
```json
{
  "success": true,
  "data": {
    "snapshot_id": "snapshot-abc",
    "storage_key": "project-zips/abc-123/snapshot-abc.zip",
    "size_bytes": 1024000,
    "sha256": "a1b2c3d4...",
    "created_at": "2024-01-01T12:00:00Z"
  }
}
```

#### `GET /api/projects/{id}/snapshot`

获取项目的快照列表。

**查询参数:**
- `page`: 页码（默认1）
- `limit`: 每页数量（默认10，最大50）
- `sort_order`: 排序方向（asc | desc，默认desc）

**响应示例:**
```json
{
  "success": true,
  "data": {
    "snapshots": [
      {
        "id": "snapshot-abc",
        "project_id": "abc-123",
        "storage_key": "project-zips/abc-123/snapshot-abc.zip",
        "size_bytes": 1024000,
        "sha256": "a1b2c3d4...",
        "created_at": "2024-01-01T12:00:00Z"
      }
    ],
    "total": 3
  }
}
```

### 4. 沙箱热迁移

#### `POST /api/projects/{id}/clone-sandbox`

执行沙箱热迁移，在沙箱即将过期时创建新沙箱并迁移项目状态。

**功能说明:**
- 在旧沙箱中创建迁移快照
- 创建新沙箱
- 在新沙箱中恢复项目文件
- 安装依赖并启动服务
- 更新项目状态指向新沙箱
- 清理旧沙箱

**响应示例:**
```json
{
  "success": true,
  "data": {
    "old_sandbox_id": "e2b_sandbox_old",
    "new_sandbox_id": "e2b_sandbox_new",
    "new_sandbox_url": "https://new.e2b.dev",
    "migration_duration": 15000,
    "status": "success", // success | partial | failed
    "message": "沙箱迁移成功完成，耗时 15000ms"
  }
}
```

## 使用流程示例

### 基本项目开发流程

1. **创建项目**
```bash
curl -X POST http://localhost:3000/api/projects \
  -H "Content-Type: application/json" \
  -d '{"name":"我的项目","model":"moonshotai/kimi-k2-instruct"}'
```

2. **打开项目**
```bash
curl -X POST http://localhost:3000/api/projects/{projectId}/open
```

3. **检查状态**
```bash
curl http://localhost:3000/api/projects/{projectId}/status
```

4. **创建快照**
```bash
curl -X POST http://localhost:3000/api/projects/{projectId}/snapshot
```

### 沙箱生命周期管理

1. **定期检查沙箱状态**
```bash
curl http://localhost:3000/api/projects/{projectId}/status
```

2. **沙箱即将过期时触发迁移**
```bash
curl -X POST http://localhost:3000/api/projects/{projectId}/clone-sandbox
```

3. **清理过期状态**
```bash
curl -X POST http://localhost:3000/api/projects/{projectId}/status \
  -H "Content-Type: application/json" \
  -d '{"action":"cleanup"}'
```

## 错误处理

所有 API 都遵循统一的错误响应格式：

```json
{
  "success": false,
  "error": {
    "error": "ERROR_CODE",
    "message": "用户友好的错误信息",
    "details": "详细的错误信息（可选）"
  }
}
```

### 常见错误代码

- `VALIDATION_ERROR`: 请求参数错误
- `NOT_FOUND`: 项目不存在
- `NO_SANDBOX`: 没有活跃的沙箱
- `DATABASE_ERROR`: 数据库操作失败
- `STORAGE_ERROR`: 存储操作失败
- `SANDBOX_ERROR`: 沙箱操作失败
- `MIGRATION_FAILED`: 迁移失败
- `INTERNAL_ERROR`: 服务器内部错误

## 性能和限制

### 沙箱限制
- 单个沙箱最大存活时间：15分钟
- 沙箱自动过期清理
- 热迁移建议在过期前2-3分钟触发

### 快照限制
- 单个快照最大尺寸：100MB
- 每个项目最多保留5个快照
- 自动清理旧快照

### 存储限制
- 项目文件排除 `node_modules`, `.git`, `.next` 等
- 单个文件最大5MB（迁移时）
- 单个文件最大10MB（快照时）

## 监控和日志

### 日志格式
所有操作都会记录详细日志，包括：
- 操作类型和项目ID
- 执行时间和状态
- 错误信息和堆栈

### 监控指标
建议监控的关键指标：
- 项目打开成功率
- 快照创建成功率
- 沙箱迁移成功率
- API 响应时间

## 测试

运行综合测试：
```bash
node scripts/test-sandbox-apis.js
```

测试覆盖：
- 项目打开流程
- 快照创建和列表
- 状态查询和操作
- 热迁移功能

## 安全考虑

1. **权限控制**: 当前为开发环境配置，生产环境需要实现用户认证
2. **资源限制**: 沙箱资源使用受 E2B 平台限制
3. **数据隔离**: 项目间完全隔离，不会互相影响
4. **密钥安全**: E2B API 密钥仅在服务端使用

## 故障排除

### 常见问题

1. **沙箱连接失败**
   - 检查 E2B API 密钥
   - 确认沙箱未过期
   - 查看沙箱状态日志

2. **快照创建失败**
   - 确认有活跃沙箱
   - 检查项目文件大小
   - 验证 Storage 权限

3. **迁移失败**
   - 检查旧沙箱连接
   - 确认新沙箱创建成功
   - 查看迁移日志

### 调试建议

1. 查看服务器日志了解详细错误
2. 使用状态查询 API 确认当前状态
3. 必要时使用强制清理重置状态
4. 检查 Supabase 数据库和 Storage 状态
