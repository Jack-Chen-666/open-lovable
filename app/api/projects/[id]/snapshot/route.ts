import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { createHash } from 'crypto'
import {
  SnapshotCreateResponse,
  SnapshotListResponse,
  ApiResponse
} from '@/types/project'

declare global {
  var activeSandbox: any;
}

/**
 * POST /api/projects/[id]/snapshot - 创建项目快照
 */
export async function POST(
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

    console.log(`📦 [snapshot] 创建项目快照: ${projectId}`)

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

      console.error('❌ [snapshot] 获取项目失败:', projectError)
      return NextResponse.json({
        success: false,
        error: {
          error: 'DATABASE_ERROR',
          message: '获取项目失败',
          details: projectError
        }
      } as ApiResponse, { status: 500 })
    }

    // 2. 检查是否有活跃的沙箱
    if (!global.activeSandbox) {
      return NextResponse.json({
        success: false,
        error: {
          error: 'NO_SANDBOX',
          message: '没有活跃的沙箱可以创建快照'
        }
      } as ApiResponse, { status: 400 })
    }

    // 3. 在沙箱中创建 ZIP 文件
    console.log('[snapshot] 在沙箱中创建 ZIP 文件...')
    
    try {
      await global.activeSandbox.runCode(`
import zipfile
import os
import hashlib
import time

os.chdir('/home/user/app')

# 创建带时间戳的 ZIP 文件
timestamp = int(time.time())
zip_filename = f'/tmp/project_snapshot_{timestamp}.zip'

# 创建 ZIP 文件，排除不必要的文件
with zipfile.ZipFile(zip_filename, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as zipf:
    for root, dirs, files in os.walk('.'):
        # 排除这些目录
        dirs[:] = [d for d in dirs if d not in [
            'node_modules', '.git', '.next', 'dist', 'build', 
            '.vscode', '.idea', '__pycache__', '.cache'
        ]]
        
        for file in files:
            # 排除这些文件
            if file in ['.DS_Store', 'Thumbs.db', '*.log', '*.tmp']:
                continue
                
            file_path = os.path.join(root, file)
            # 检查文件大小，排除过大的文件
            try:
                if os.path.getsize(file_path) > 10 * 1024 * 1024:  # 10MB
                    print(f"Skipping large file: {file_path}")
                    continue
            except:
                continue
                
            arcname = os.path.relpath(file_path, '.')
            try:
                zipf.write(file_path, arcname)
            except Exception as e:
                print(f"Error adding {file_path}: {e}")

# 获取文件信息
file_size = os.path.getsize(zip_filename)

# 计算 SHA256 哈希
sha256_hash = hashlib.sha256()
with open(zip_filename, 'rb') as f:
    for chunk in iter(lambda: f.read(4096), b""):
        sha256_hash.update(chunk)

print(f"ZIP_FILE_PATH: {zip_filename}")
print(f"ZIP_FILE_SIZE: {file_size}")
print(f"ZIP_SHA256: {sha256_hash.hexdigest()}")
      `)
    } catch (error) {
      console.error('❌ [snapshot] 创建 ZIP 文件失败:', error)
      return NextResponse.json({
        success: false,
        error: {
          error: 'SANDBOX_ERROR',
          message: '在沙箱中创建快照失败',
          details: error instanceof Error ? error.message : String(error)
        }
      } as ApiResponse, { status: 500 })
    }

    // 4. 读取 ZIP 文件内容
    console.log('[snapshot] 读取 ZIP 文件内容...')
    
    let zipContent: string
    let fileSize: number
    let sha256Hash: string
    
    try {
      const result = await global.activeSandbox.runCode(`
import base64
import os
import glob

# 找到最新的快照文件
zip_files = glob.glob('/tmp/project_snapshot_*.zip')
if not zip_files:
    raise Exception("No snapshot file found")

latest_zip = max(zip_files, key=os.path.getctime)

# 读取文件并转换为 base64
with open(latest_zip, 'rb') as f:
    content = f.read()
    encoded = base64.b64encode(content).decode('utf-8')
    
print(f"BASE64_CONTENT_LENGTH: {len(encoded)}")
print("BASE64_CONTENT_START")
print(encoded)
print("BASE64_CONTENT_END")
      `)

      // 从输出中提取信息
      const logs = result.logs.stdout.join('\n')
      const base64Match = logs.match(/BASE64_CONTENT_START\n([\s\S]*?)\nBASE64_CONTENT_END/)
      
      if (!base64Match) {
        throw new Error('无法从沙箱获取 ZIP 内容')
      }
      
      zipContent = base64Match[1].trim()
      
      // 从之前的输出获取文件信息
      const prevLogs = result.logs.stdout.join('\n')
      const sizeMatch = prevLogs.match(/ZIP_FILE_SIZE: (\d+)/)
      const hashMatch = prevLogs.match(/ZIP_SHA256: ([a-f0-9]+)/)
      
      fileSize = sizeMatch ? parseInt(sizeMatch[1]) : Buffer.from(zipContent, 'base64').length
      sha256Hash = hashMatch ? hashMatch[1] : createHash('sha256').update(Buffer.from(zipContent, 'base64')).digest('hex')
      
    } catch (error) {
      console.error('❌ [snapshot] 读取 ZIP 文件失败:', error)
      return NextResponse.json({
        success: false,
        error: {
          error: 'SANDBOX_ERROR',
          message: '读取快照文件失败',
          details: error instanceof Error ? error.message : String(error)
        }
      } as ApiResponse, { status: 500 })
    }

    // 5. 创建快照记录
    const { data: snapshot, error: snapshotError } = await supabaseServer
      .from('project_snapshots')
      .insert({
        project_id: projectId,
        storage_key: '', // 先创建记录，获取ID后更新
        size_bytes: fileSize,
        sha256: sha256Hash
      })
      .select()
      .single()

    if (snapshotError) {
      console.error('❌ [snapshot] 创建快照记录失败:', snapshotError)
      return NextResponse.json({
        success: false,
        error: {
          error: 'DATABASE_ERROR',
          message: '创建快照记录失败',
          details: snapshotError
        }
      } as ApiResponse, { status: 500 })
    }

    // 6. 上传到 Supabase Storage
    const storageKey = `project-zips/${projectId}/${snapshot.id}.zip`
    
    console.log(`[snapshot] 上传快照到 Storage: ${storageKey}`)
    
    try {
      const zipBuffer = Buffer.from(zipContent, 'base64')
      
      const { data: uploadData, error: uploadError } = await supabaseServer.storage
        .from('project-zips')
        .upload(storageKey, zipBuffer, {
          contentType: 'application/zip',
          duplex: 'half'
        })

      if (uploadError) {
        // 删除已创建的快照记录
        await supabaseServer
          .from('project_snapshots')
          .delete()
          .eq('id', snapshot.id)
        
        console.error('❌ [snapshot] 上传快照失败:', uploadError)
        return NextResponse.json({
          success: false,
          error: {
            error: 'STORAGE_ERROR',
            message: '上传快照失败',
            details: uploadError
          }
        } as ApiResponse, { status: 500 })
      }

      console.log(`✅ [snapshot] 快照上传成功: ${uploadData.path}`)
      
    } catch (error) {
      // 删除已创建的快照记录
      await supabaseServer
        .from('project_snapshots')
        .delete()
        .eq('id', snapshot.id)
      
      console.error('❌ [snapshot] 上传快照异常:', error)
      return NextResponse.json({
        success: false,
        error: {
          error: 'STORAGE_ERROR',
          message: '上传快照异常',
          details: error instanceof Error ? error.message : String(error)
        }
      } as ApiResponse, { status: 500 })
    }

    // 7. 更新快照记录的 storage_key
    const { error: updateError } = await supabaseServer
      .from('project_snapshots')
      .update({ storage_key: storageKey })
      .eq('id', snapshot.id)

    if (updateError) {
      console.warn('⚠️ [snapshot] 更新快照记录失败:', updateError)
    }

    // 8. 更新项目状态中的最新快照ID
    await supabaseServer
      .from('project_state')
      .update({ last_snapshot_id: snapshot.id })
      .eq('project_id', projectId)

    // 9. 清理旧快照（保留最近5个）
    try {
      const { data: oldSnapshots } = await supabaseServer
        .from('project_snapshots')
        .select('id, storage_key')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .range(5, 100) // 跳过最新的5个，获取更老的

      if (oldSnapshots && oldSnapshots.length > 0) {
        console.log(`[snapshot] 清理 ${oldSnapshots.length} 个旧快照`)
        
        // 删除 Storage 中的文件
        const filesToDelete = oldSnapshots
          .filter(s => s.storage_key)
          .map(s => s.storage_key)
        
        if (filesToDelete.length > 0) {
          const { error: deleteStorageError } = await supabaseServer.storage
            .from('project-zips')
            .remove(filesToDelete)
          
          if (deleteStorageError) {
            console.warn('⚠️ [snapshot] 清理旧快照文件失败:', deleteStorageError)
          }
        }

        // 删除数据库记录
        const { error: deleteDbError } = await supabaseServer
          .from('project_snapshots')
          .delete()
          .in('id', oldSnapshots.map(s => s.id))

        if (deleteDbError) {
          console.warn('⚠️ [snapshot] 清理旧快照记录失败:', deleteDbError)
        }
      }
    } catch (error) {
      console.warn('⚠️ [snapshot] 清理旧快照失败:', error)
    }

    // 10. 清理沙箱中的临时文件
    try {
      await global.activeSandbox.runCode(`
import os
import glob

# 清理临时快照文件
zip_files = glob.glob('/tmp/project_snapshot_*.zip')
for zip_file in zip_files:
    try:
        os.remove(zip_file)
        print(f"Cleaned up: {zip_file}")
    except:
        pass
      `)
    } catch (error) {
      console.warn('⚠️ [snapshot] 清理临时文件失败:', error)
    }

    const response: SnapshotCreateResponse = {
      snapshot_id: snapshot.id,
      storage_key: storageKey,
      size_bytes: fileSize,
      sha256: sha256Hash,
      created_at: snapshot.created_at
    }

    console.log(`🎉 [snapshot] 快照创建成功: ${snapshot.id} (${fileSize} bytes)`)

    return NextResponse.json({
      success: true,
      data: response
    } as ApiResponse<SnapshotCreateResponse>)

  } catch (error) {
    console.error('❌ [snapshot] 创建快照异常:', error)
    return NextResponse.json({
      success: false,
      error: {
        error: 'INTERNAL_ERROR',
        message: '创建快照失败',
        details: error instanceof Error ? error.message : String(error)
      }
    } as ApiResponse, { status: 500 })
  }
}

/**
 * GET /api/projects/[id]/snapshot - 获取项目快照列表
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const projectId = params.id
    const { searchParams } = new URL(request.url)
    
    const page = parseInt(searchParams.get('page') || '1')
    const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 50)
    const sortOrder = searchParams.get('sort_order') === 'asc' ? 'asc' : 'desc'

    if (!projectId) {
      return NextResponse.json({
        success: false,
        error: {
          error: 'VALIDATION_ERROR',
          message: '项目ID不能为空'
        }
      } as ApiResponse, { status: 400 })
    }

    console.log(`📋 [snapshot] 获取快照列表: ${projectId}`)

    // 验证项目是否存在
    const { data: project, error: projectError } = await supabaseServer
      .from('projects')
      .select('id')
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
          message: '验证项目失败',
          details: projectError
        }
      } as ApiResponse, { status: 500 })
    }

    // 获取快照列表
    const offset = (page - 1) * limit
    
    const { data: snapshots, error: snapshotsError, count } = await supabaseServer
      .from('project_snapshots')
      .select('*', { count: 'exact' })
      .eq('project_id', projectId)
      .order('created_at', { ascending: sortOrder === 'asc' })
      .range(offset, offset + limit - 1)

    if (snapshotsError) {
      console.error('❌ [snapshot] 获取快照列表失败:', snapshotsError)
      return NextResponse.json({
        success: false,
        error: {
          error: 'DATABASE_ERROR',
          message: '获取快照列表失败',
          details: snapshotsError
        }
      } as ApiResponse, { status: 500 })
    }

    const response: SnapshotListResponse = {
      snapshots: snapshots || [],
      total: count || 0
    }

    return NextResponse.json({
      success: true,
      data: response
    } as ApiResponse<SnapshotListResponse>)

  } catch (error) {
    console.error('❌ [snapshot] 获取快照列表异常:', error)
    return NextResponse.json({
      success: false,
      error: {
        error: 'INTERNAL_ERROR',
        message: '获取快照列表失败',
        details: error instanceof Error ? error.message : String(error)
      }
    } as ApiResponse, { status: 500 })
  }
}
