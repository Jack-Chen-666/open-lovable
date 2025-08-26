import { NextRequest, NextResponse } from 'next/server'
import { Sandbox } from '@e2b/code-interpreter'
import { supabaseServer } from '@/lib/supabase/server'
import {
  ProjectStatusResponse,
  SandboxStatus,
  ApiResponse
} from '@/types/project'

declare global {
  var activeSandbox: any;
}

/**
 * GET /api/projects/[id]/status - 获取项目状态
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const projectId = params.id

    if (!projectId) {
      return NextResponse.json({
        success: false,
        error: {
          error: 'VALIDATION_ERROR',
          message: '项目ID不能为空'
        }
      } as ApiResponse, { status: 400 })
    }

    console.log(`📊 [status] 获取项目状态: ${projectId}`)

    // 1. 验证项目是否存在
    const { data: project, error: projectError } = await supabaseServer
      .from('projects')
      .select('id, name')
      .eq('id', projectId)
      .single()

    if (projectError) {
      if (projectError.code === 'PGRST116') {
        return NextResponse.json({
          success: false,
          error: {
            error: 'NOT_FOUND',
            message: '项目不存在'
          }
        } as ApiResponse, { status: 404 })
      }

      console.error('❌ [status] 获取项目失败:', projectError)
      return NextResponse.json({
        success: false,
        error: {
          error: 'DATABASE_ERROR',
          message: '获取项目失败',
          details: projectError
        }
      } as ApiResponse, { status: 500 })
    }

    // 2. 获取项目状态
    const { data: projectState, error: stateError } = await supabaseServer
      .from('project_state')
      .select('*')
      .eq('project_id', projectId)
      .single()

    if (stateError && stateError.code !== 'PGRST116') {
      console.error('❌ [status] 获取项目状态失败:', stateError)
      return NextResponse.json({
        success: false,
        error: {
          error: 'DATABASE_ERROR',
          message: '获取项目状态失败',
          details: stateError
        }
      } as ApiResponse, { status: 500 })
    }

    // 3. 获取快照数量和最新快照
    const { data: snapshotsData, error: snapshotsError } = await supabaseServer
      .from('project_snapshots')
      .select('id, storage_key, size_bytes, sha256, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })

    if (snapshotsError) {
      console.warn('⚠️ [status] 获取快照信息失败:', snapshotsError)
    }

    const snapshots = snapshotsData || []
    const latestSnapshot = snapshots.length > 0 ? snapshots[0] : undefined

    // 4. 检查沙箱状态
    let sandboxStatus: SandboxStatus = SandboxStatus.UNKNOWN
    let sandboxHealthy = false

    if (projectState?.sandbox_id) {
      try {
        // 检查沙箱是否过期
        const expiresAt = new Date(projectState.sandbox_expires_at || 0)
        const now = new Date()
        
        if (expiresAt.getTime() <= now.getTime()) {
          sandboxStatus = SandboxStatus.EXPIRED
        } else {
          // 尝试连接沙箱检查健康状态
          console.log(`[status] 检查沙箱健康状态: ${projectState.sandbox_id}`)
          
          try {
            const sandbox = await Sandbox.connect(projectState.sandbox_id, {
              apiKey: process.env.E2B_API_KEY
            })

            // 执行简单的健康检查
            const healthCheck = await sandbox.runCode(`
import os
import time

# 基础健康检查
print("HEALTH_CHECK_START")
print(f"Current time: {time.time()}")
print(f"Working directory: {os.getcwd()}")
print(f"Home exists: {os.path.exists('/home/user')}")
print(f"App directory exists: {os.path.exists('/home/user/app')}")

# 检查基本命令
try:
    import subprocess
    result = subprocess.run(['node', '--version'], capture_output=True, text=True, timeout=5)
    print(f"Node.js version: {result.stdout.strip()}")
except Exception as e:
    print(f"Node.js check failed: {e}")

print("HEALTH_CHECK_END")
            `, { timeoutMs: 10000 })

            const healthOutput = healthCheck.logs.stdout.join('\n')
            
            if (healthOutput.includes('HEALTH_CHECK_START') && healthOutput.includes('HEALTH_CHECK_END')) {
              sandboxStatus = SandboxStatus.RUNNING
              sandboxHealthy = true
              console.log(`✅ [status] 沙箱健康检查通过`)
            } else {
              sandboxStatus = SandboxStatus.STOPPED
              console.log(`⚠️ [status] 沙箱健康检查部分失败`)
            }

            // 可选：检查 Vite 服务器状态
            try {
              const viteCheck = await sandbox.runCode(`
import subprocess
import time

try:
    # 检查 5173 端口是否被占用
    result = subprocess.run(['netstat', '-tlnp'], capture_output=True, text=True, timeout=5)
    if ':5173' in result.stdout:
        print("VITE_RUNNING: true")
    else:
        print("VITE_RUNNING: false")
except Exception as e:
    print(f"VITE_CHECK_FAILED: {e}")
              `, { timeoutMs: 5000 })

              const viteOutput = viteCheck.logs.stdout.join('\n')
              if (viteOutput.includes('VITE_RUNNING: true')) {
                console.log(`🚀 [status] Vite 服务器正在运行`)
              }
            } catch (error) {
              console.log(`⚠️ [status] Vite 状态检查失败: ${error}`)
            }

          } catch (connectionError) {
            console.log(`❌ [status] 沙箱连接失败: ${connectionError}`)
            sandboxStatus = SandboxStatus.STOPPED
          }
        }
      } catch (error) {
        console.warn('⚠️ [status] 沙箱状态检查异常:', error)
        sandboxStatus = SandboxStatus.UNKNOWN
      }
    } else {
      sandboxStatus = SandboxStatus.STOPPED
    }

    // 5. 构建响应
    const response: ProjectStatusResponse = {
      project_id: projectId,
      sandbox_id: projectState?.sandbox_id || null,
      sandbox_url: projectState?.sandbox_url || null,
      sandbox_status: sandboxStatus,
      expires_at: projectState?.sandbox_expires_at || null,
      snapshots_count: snapshots.length,
      latest_snapshot: latestSnapshot
    }

    // 6. 可选：如果沙箱已过期但数据库中仍有记录，清理状态
    if (sandboxStatus === SandboxStatus.EXPIRED && projectState) {
      console.log(`🧹 [status] 清理过期沙箱状态: ${projectState.sandbox_id}`)
      
      try {
        await supabaseServer
          .from('project_state')
          .update({
            sandbox_id: null,
            sandbox_url: null,
            sandbox_started_at: null,
            sandbox_expires_at: null
          })
          .eq('project_id', projectId)
          
        // 更新响应
        response.sandbox_id = null
        response.sandbox_url = null
        response.expires_at = null
      } catch (error) {
        console.warn('⚠️ [status] 清理过期状态失败:', error)
      }
    }

    // 7. 记录状态检查日志
    console.log(`📊 [status] 项目状态检查完成:`)
    console.log(`   - 项目: ${project.name}`)
    console.log(`   - 沙箱状态: ${sandboxStatus}`)
    console.log(`   - 沙箱ID: ${response.sandbox_id || 'None'}`)
    console.log(`   - 快照数量: ${response.snapshots_count}`)
    console.log(`   - 健康状态: ${sandboxHealthy ? '健康' : '未知'}`)

    return NextResponse.json({
      success: true,
      data: response
    } as ApiResponse<ProjectStatusResponse>)

  } catch (error) {
    console.error('❌ [status] 获取项目状态异常:', error)
    return NextResponse.json({
      success: false,
      error: {
        error: 'INTERNAL_ERROR',
        message: '获取项目状态失败',
        details: error instanceof Error ? error.message : String(error)
      }
    } as ApiResponse, { status: 500 })
  }
}

/**
 * POST /api/projects/[id]/status - 手动触发状态刷新和清理
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const projectId = params.id
    const body = await request.json().catch(() => ({}))
    const { action } = body

    if (!projectId) {
      return NextResponse.json({
        success: false,
        error: {
          error: 'VALIDATION_ERROR',
          message: '项目ID不能为空'
        }
      } as ApiResponse, { status: 400 })
    }

    console.log(`🔄 [status] 执行状态操作: ${projectId}, action: ${action}`)

    // 验证项目是否存在
    const { data: project, error: projectError } = await supabaseServer
      .from('projects')
      .select('id, name')
      .eq('id', projectId)
      .single()

    if (projectError) {
      if (projectError.code === 'PGRST116') {
        return NextResponse.json({
          success: false,
          error: {
            error: 'NOT_FOUND',
            message: '项目不存在'
          }
        } as ApiResponse, { status: 404 })
      }

      return NextResponse.json({
        success: false,
        error: {
          error: 'DATABASE_ERROR',
          message: '获取项目失败',
          details: projectError
        }
      } as ApiResponse, { status: 500 })
    }

    switch (action) {
      case 'refresh':
        // 刷新状态（重新执行 GET 逻辑）
        console.log(`🔄 [status] 刷新项目状态`)
        return await GET(request, { params })

      case 'cleanup':
        // 清理过期或无效的沙箱状态
        console.log(`🧹 [status] 清理项目状态`)
        
        const { data: projectState } = await supabaseServer
          .from('project_state')
          .select('*')
          .eq('project_id', projectId)
          .single()

        if (projectState?.sandbox_id) {
          // 检查沙箱是否过期
          const expiresAt = new Date(projectState.sandbox_expires_at || 0)
          const now = new Date()
          
          if (expiresAt.getTime() <= now.getTime()) {
            // 清理过期状态
            await supabaseServer
              .from('project_state')
              .update({
                sandbox_id: null,
                sandbox_url: null,
                sandbox_started_at: null,
                sandbox_expires_at: null
              })
              .eq('project_id', projectId)
              
            return NextResponse.json({
              success: true,
              data: { message: '已清理过期的沙箱状态' }
            } as ApiResponse)
          }
        }

        return NextResponse.json({
          success: true,
          data: { message: '没有需要清理的状态' }
        } as ApiResponse)

      case 'force_cleanup':
        // 强制清理所有沙箱状态
        console.log(`💣 [status] 强制清理项目状态`)
        
        await supabaseServer
          .from('project_state')
          .update({
            sandbox_id: null,
            sandbox_url: null,
            sandbox_started_at: null,
            sandbox_expires_at: null
          })
          .eq('project_id', projectId)

        // 如果当前全局沙箱属于这个项目，也清理
        if (global.activeSandbox && global.sandboxData) {
          try {
            await global.activeSandbox.kill()
            global.activeSandbox = null
            global.sandboxData = null
          } catch (error) {
            console.warn('⚠️ 清理全局沙箱失败:', error)
          }
        }

        return NextResponse.json({
          success: true,
          data: { message: '已强制清理所有沙箱状态' }
        } as ApiResponse)

      default:
        return NextResponse.json({
          success: false,
          error: {
            error: 'VALIDATION_ERROR',
            message: '不支持的操作类型'
          }
        } as ApiResponse, { status: 400 })
    }

  } catch (error) {
    console.error('❌ [status] 状态操作异常:', error)
    return NextResponse.json({
      success: false,
      error: {
        error: 'INTERNAL_ERROR',
        message: '状态操作失败',
        details: error instanceof Error ? error.message : String(error)
      }
    } as ApiResponse, { status: 500 })
  }
}
