import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import {
  Project,
  CreateProjectRequest,
  ProjectListResponse,
  ProjectListParams,
  ApiResponse
} from '@/types/project'

/**
 * GET /api/projects - 获取项目列表
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    
    // 解析查询参数
    const params: ProjectListParams = {
      page: parseInt(searchParams.get('page') || '1'),
      limit: Math.min(parseInt(searchParams.get('limit') || '20'), 100), // 最大100条
      visibility: (searchParams.get('visibility') as any) || 'all',
      sort_by: (searchParams.get('sort_by') as any) || 'created_at',
      sort_order: (searchParams.get('sort_order') as any) || 'desc',
      search: searchParams.get('search') || undefined
    }

    console.log('📋 获取项目列表:', params)

    // 构建查询
    let query = supabaseServer
      .from('projects')
      .select('*', { count: 'exact' })

    // 添加可见性过滤
    if (params.visibility && params.visibility !== 'all') {
      query = query.eq('visibility', params.visibility)
    }

    // 添加搜索过滤
    if (params.search) {
      query = query.ilike('name', `%${params.search}%`)
    }

    // 添加排序
    const sortColumn = params.sort_by || 'created_at'
    const sortOrder = params.sort_order === 'asc' ? 'asc' : 'desc'
    query = query.order(sortColumn, { ascending: sortOrder === 'asc' })

    // 添加分页
    const offset = ((params.page || 1) - 1) * (params.limit || 20)
    query = query.range(offset, offset + (params.limit || 20) - 1)

    const { data: projects, error, count } = await query

    if (error) {
      console.error('❌ 获取项目列表失败:', error)
      return NextResponse.json({
        success: false,
        error: {
          error: 'DATABASE_ERROR',
          message: '获取项目列表失败',
          details: error
        }
      } as ApiResponse, { status: 500 })
    }

    const response: ProjectListResponse = {
      projects: projects || [],
      total: count || 0
    }

    console.log(`✅ 获取项目列表成功: ${projects?.length || 0} 项目, 总计: ${count}`)

    return NextResponse.json({
      success: true,
      data: response
    } as ApiResponse<ProjectListResponse>)

  } catch (error) {
    console.error('❌ 获取项目列表异常:', error)
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
 * POST /api/projects - 创建新项目
 */
export async function POST(request: NextRequest) {
  try {
    const body: CreateProjectRequest = await request.json()

    // 验证必需字段
    if (!body.name || body.name.trim().length === 0) {
      return NextResponse.json({
        success: false,
        error: {
          error: 'VALIDATION_ERROR',
          message: '项目名称不能为空'
        }
      } as ApiResponse, { status: 400 })
    }

    // 验证项目名称长度
    if (body.name.length > 100) {
      return NextResponse.json({
        success: false,
        error: {
          error: 'VALIDATION_ERROR',
          message: '项目名称不能超过100个字符'
        }
      } as ApiResponse, { status: 400 })
    }

    // 验证模型（如果提供）
    const supportedModels = [
      'moonshotai/kimi-k2-instruct',
      'anthropic/claude-3-sonnet',
      'openai/gpt-4',
      'openai/gpt-3.5-turbo'
    ]
    
    if (body.model && !supportedModels.includes(body.model)) {
      return NextResponse.json({
        success: false,
        error: {
          error: 'VALIDATION_ERROR',
          message: '不支持的模型类型'
        }
      } as ApiResponse, { status: 400 })
    }

    console.log('🚀 创建新项目:', body.name)

    // 创建项目
    const { data: project, error } = await supabaseServer
      .from('projects')
      .insert({
        name: body.name.trim(),
        visibility: body.visibility || 'private',
        model: body.model || 'moonshotai/kimi-k2-instruct'
      })
      .select()
      .single()

    if (error) {
      console.error('❌ 创建项目失败:', error)
      
      // 检查是否是重复名称错误
      if (error.code === '23505') {
        return NextResponse.json({
          success: false,
          error: {
            error: 'DUPLICATE_NAME',
            message: '项目名称已存在'
          }
        } as ApiResponse, { status: 409 })
      }

      return NextResponse.json({
        success: false,
        error: {
          error: 'DATABASE_ERROR',
          message: '创建项目失败',
          details: error
        }
      } as ApiResponse, { status: 500 })
    }

    // 同时为项目创建空的状态记录
    const { error: stateError } = await supabaseServer
      .from('project_state')
      .insert({
        project_id: project.id
      })

    if (stateError) {
      console.warn('⚠️ 创建项目状态记录失败:', stateError)
      // 不阻塞项目创建，但记录警告
    }

    console.log(`✅ 项目创建成功: ${project.id} - ${project.name}`)

    return NextResponse.json({
      success: true,
      data: project
    } as ApiResponse<Project>, { status: 201 })

  } catch (error) {
    console.error('❌ 创建项目异常:', error)
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
