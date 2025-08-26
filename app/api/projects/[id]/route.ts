import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import {
  Project,
  UpdateProjectRequest,
  ProjectDetailResponse,
  ApiResponse
} from '@/types/project'

/**
 * GET /api/projects/[id] - 获取项目详情
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

    console.log('📋 获取项目详情:', projectId)

    // 获取项目基本信息
    const { data: project, error: projectError } = await supabaseServer
      .from('projects')
      .select('*')
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

      console.error('❌ 获取项目失败:', projectError)
      return NextResponse.json({
        success: false,
        error: {
          error: 'DATABASE_ERROR',
          message: '获取项目失败',
          details: projectError
        }
      } as ApiResponse, { status: 500 })
    }

    // 获取项目状态
    const { data: state, error: stateError } = await supabaseServer
      .from('project_state')
      .select('*')
      .eq('project_id', projectId)
      .single()

    if (stateError && stateError.code !== 'PGRST116') {
      console.warn('⚠️ 获取项目状态失败:', stateError)
    }

    // 获取最新快照
    const { data: latestSnapshot, error: snapshotError } = await supabaseServer
      .from('project_snapshots')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (snapshotError && snapshotError.code !== 'PGRST116') {
      console.warn('⚠️ 获取最新快照失败:', snapshotError)
    }

    const response: ProjectDetailResponse = {
      ...project,
      state: state || undefined,
      latest_snapshot: latestSnapshot || undefined
    }

    console.log(`✅ 获取项目详情成功: ${project.name}`)

    return NextResponse.json({
      success: true,
      data: response
    } as ApiResponse<ProjectDetailResponse>)

  } catch (error) {
    console.error('❌ 获取项目详情异常:', error)
    return NextResponse.json({
      success: false,
      error: {
        error: 'INTERNAL_ERROR',
        message: '服务器内部错误',
        details: error
      }
    } as ApiResponse, { status: 500 })
  }
}

/**
 * PATCH /api/projects/[id] - 更新项目信息
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const projectId = params.id
    const body: UpdateProjectRequest = await request.json()

    if (!projectId) {
      return NextResponse.json({
        success: false,
        error: {
          error: 'VALIDATION_ERROR',
          message: '项目ID不能为空'
        }
      } as ApiResponse, { status: 400 })
    }

    // 验证更新数据
    const updateData: Partial<Project> = {}

    if (body.name !== undefined) {
      if (!body.name || body.name.trim().length === 0) {
        return NextResponse.json({
          success: false,
          error: {
            error: 'VALIDATION_ERROR',
            message: '项目名称不能为空'
          }
        } as ApiResponse, { status: 400 })
      }

      if (body.name.length > 100) {
        return NextResponse.json({
          success: false,
          error: {
            error: 'VALIDATION_ERROR',
            message: '项目名称不能超过100个字符'
          }
        } as ApiResponse, { status: 400 })
      }

      updateData.name = body.name.trim()
    }

    if (body.model !== undefined) {
      const supportedModels = [
        'moonshotai/kimi-k2-instruct',
        'anthropic/claude-3-sonnet',
        'openai/gpt-4',
        'openai/gpt-3.5-turbo'
      ]

      if (!supportedModels.includes(body.model)) {
        return NextResponse.json({
          success: false,
          error: {
            error: 'VALIDATION_ERROR',
            message: '不支持的模型类型'
          }
        } as ApiResponse, { status: 400 })
      }

      updateData.model = body.model
    }

    if (body.visibility !== undefined) {
      if (!['private', 'public'].includes(body.visibility)) {
        return NextResponse.json({
          success: false,
          error: {
            error: 'VALIDATION_ERROR',
            message: '可见性只能是 private 或 public'
          }
        } as ApiResponse, { status: 400 })
      }

      updateData.visibility = body.visibility
    }

    // 检查是否有要更新的数据
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({
        success: false,
        error: {
          error: 'VALIDATION_ERROR',
          message: '没有提供要更新的数据'
        }
      } as ApiResponse, { status: 400 })
    }

    console.log('📝 更新项目:', projectId, updateData)

    // 更新项目
    const { data: project, error } = await supabaseServer
      .from('projects')
      .update(updateData)
      .eq('id', projectId)
      .select()
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({
          success: false,
          error: {
            error: 'NOT_FOUND',
            message: '项目不存在'
          }
        } as ApiResponse, { status: 404 })
      }

      if (error.code === '23505') {
        return NextResponse.json({
          success: false,
          error: {
            error: 'DUPLICATE_NAME',
            message: '项目名称已存在'
          }
        } as ApiResponse, { status: 409 })
      }

      console.error('❌ 更新项目失败:', error)
      return NextResponse.json({
        success: false,
        error: {
          error: 'DATABASE_ERROR',
          message: '更新项目失败',
          details: error
        }
      } as ApiResponse, { status: 500 })
    }

    console.log(`✅ 项目更新成功: ${project.name}`)

    return NextResponse.json({
      success: true,
      data: project
    } as ApiResponse<Project>)

  } catch (error) {
    console.error('❌ 更新项目异常:', error)
    return NextResponse.json({
      success: false,
      error: {
        error: 'INTERNAL_ERROR',
        message: '服务器内部错误',
        details: error
      }
    } as ApiResponse, { status: 500 })
  }
}

/**
 * DELETE /api/projects/[id] - 删除项目
 */
export async function DELETE(
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

    console.log('🗑️ 删除项目:', projectId)

    // 首先检查项目是否存在
    const { data: project, error: checkError } = await supabaseServer
      .from('projects')
      .select('id, name')
      .eq('id', projectId)
      .single()

    if (checkError) {
      if (checkError.code === 'PGRST116') {
        return NextResponse.json({
          success: false,
          error: {
            error: 'NOT_FOUND',
            message: '项目不存在'
          }
        } as ApiResponse, { status: 404 })
      }

      console.error('❌ 检查项目失败:', checkError)
      return NextResponse.json({
        success: false,
        error: {
          error: 'DATABASE_ERROR',
          message: '检查项目失败',
          details: checkError
        }
      } as ApiResponse, { status: 500 })
    }

    // TODO: 清理相关的 Storage 文件（快照ZIP、截图等）
    // 这里可以添加清理逻辑，或者通过数据库级联删除

    // 删除项目（会自动级联删除相关的 state、snapshots、manifests）
    const { error: deleteError } = await supabaseServer
      .from('projects')
      .delete()
      .eq('id', projectId)

    if (deleteError) {
      console.error('❌ 删除项目失败:', deleteError)
      return NextResponse.json({
        success: false,
        error: {
          error: 'DATABASE_ERROR',
          message: '删除项目失败',
          details: deleteError
        }
      } as ApiResponse, { status: 500 })
    }

    console.log(`✅ 项目删除成功: ${project.name}`)

    return NextResponse.json({
      success: true,
      data: {
        id: projectId,
        message: '项目删除成功'
      }
    } as ApiResponse<{ id: string; message: string }>)

  } catch (error) {
    console.error('❌ 删除项目异常:', error)
    return NextResponse.json({
      success: false,
      error: {
        error: 'INTERNAL_ERROR',
        message: '服务器内部错误',
        details: error
      }
    } as ApiResponse, { status: 500 })
  }
}
