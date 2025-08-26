import { NextRequest, NextResponse } from 'next/server'
import { Sandbox } from '@e2b/code-interpreter'
import { supabaseServer } from '@/lib/supabase/server'
import { appConfig } from '@/config/app.config'
import {
  SandboxCloneResponse,
  ApiResponse
} from '@/types/project'

declare global {
  var activeSandbox: any;
  var sandboxData: any;
}

/**
 * POST /api/projects/[id]/clone-sandbox - 沙箱热迁移
 * 
 * 在沙箱即将过期时，创建新沙箱并迁移当前项目状态
 * 实现无缝的沙箱切换，避免用户工作中断
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const startTime = Date.now()
  let oldSandbox: any = null
  let newSandbox: any = null
  
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

    console.log(`🔄 [clone-sandbox] 开始沙箱热迁移: ${projectId}`)

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

      console.error('❌ [clone-sandbox] 获取项目失败:', projectError)
      return NextResponse.json({
        success: false,
        error: {
          error: 'DATABASE_ERROR',
          message: '获取项目失败',
          details: projectError
        }
      } as ApiResponse, { status: 500 })
    }

    // 2. 获取当前项目状态
    const { data: projectState, error: stateError } = await supabaseServer
      .from('project_state')
      .select('*')
      .eq('project_id', projectId)
      .single()

    if (stateError || !projectState?.sandbox_id) {
      return NextResponse.json({
        success: false,
        error: {
          error: 'NO_SANDBOX',
          message: '没有找到当前沙箱'
        }
      } as ApiResponse, { status: 400 })
    }

    console.log(`📦 [clone-sandbox] 当前沙箱: ${projectState.sandbox_id}`)

    // 3. 连接到旧沙箱
    try {
      oldSandbox = await Sandbox.connect(projectState.sandbox_id, {
        apiKey: process.env.E2B_API_KEY
      })
      console.log(`✅ [clone-sandbox] 成功连接到旧沙箱`)
    } catch (error) {
      console.error(`❌ [clone-sandbox] 连接旧沙箱失败: ${error}`)
      return NextResponse.json({
        success: false,
        error: {
          error: 'SANDBOX_CONNECTION_ERROR',
          message: '无法连接到当前沙箱',
          details: error instanceof Error ? error.message : String(error)
        }
      } as ApiResponse, { status: 500 })
    }

    // 4. 在旧沙箱中创建快照
    console.log(`📸 [clone-sandbox] 在旧沙箱中创建迁移快照...`)
    
    let migrationZipContent: string
    
    try {
      await oldSandbox.runCode(`
import zipfile
import os
import time

os.chdir('/home/user/app')

# 创建迁移快照
migration_filename = f'/tmp/migration_snapshot_{int(time.time())}.zip'

with zipfile.ZipFile(migration_filename, 'w', zipfile.ZIP_DEFLATED, compresslevel=1) as zipf:
    for root, dirs, files in os.walk('.'):
        # 排除不必要的目录（速度优化）
        dirs[:] = [d for d in dirs if d not in [
            'node_modules', '.git', '.next', 'dist', 'build',
            '.vscode', '.idea', '__pycache__', '.cache'
        ]]
        
        for file in files:
            if file in ['.DS_Store', 'Thumbs.db']:
                continue
                
            file_path = os.path.join(root, file)
            # 跳过大文件以加速迁移
            try:
                if os.path.getsize(file_path) > 5 * 1024 * 1024:  # 5MB
                    continue
            except:
                continue
                
            arcname = os.path.relpath(file_path, '.')
            try:
                zipf.write(file_path, arcname)
            except Exception as e:
                print(f"Warning: Could not add {file_path}: {e}")

file_size = os.path.getsize(migration_filename)
print(f"MIGRATION_ZIP_CREATED: {migration_filename} ({file_size} bytes)")
      `)

      // 读取快照内容
      const readResult = await oldSandbox.runCode(`
import base64
import glob

# 找到迁移快照文件
zip_files = glob.glob('/tmp/migration_snapshot_*.zip')
if not zip_files:
    raise Exception("Migration snapshot not found")

latest_zip = max(zip_files, key=os.path.getctime)

# 读取并编码
with open(latest_zip, 'rb') as f:
    content = f.read()
    encoded = base64.b64encode(content).decode('utf-8')

print("MIGRATION_CONTENT_START")
print(encoded)
print("MIGRATION_CONTENT_END")
      `)

      const logs = readResult.logs.stdout.join('\n')
      const contentMatch = logs.match(/MIGRATION_CONTENT_START\n(.*?)\nMIGRATION_CONTENT_END/s)
      
      if (!contentMatch) {
        throw new Error('无法获取迁移快照内容')
      }
      
      migrationZipContent = contentMatch[1].trim()
      console.log(`✅ [clone-sandbox] 迁移快照创建成功 (${migrationZipContent.length} chars)`)
      
    } catch (error) {
      console.error(`❌ [clone-sandbox] 创建迁移快照失败: ${error}`)
      return NextResponse.json({
        success: false,
        error: {
          error: 'MIGRATION_SNAPSHOT_ERROR',
          message: '创建迁移快照失败',
          details: error instanceof Error ? error.message : String(error)
        }
      } as ApiResponse, { status: 500 })
    }

    // 5. 创建新沙箱
    console.log(`🚀 [clone-sandbox] 创建新沙箱...`)
    
    try {
      newSandbox = await Sandbox.create({
        apiKey: process.env.E2B_API_KEY,
        timeoutMs: appConfig.e2b.timeoutMs
      })

      const newSandboxId = (newSandbox as any).sandboxId
      const newHost = (newSandbox as any).getHost(appConfig.e2b.vitePort)
      const newSandboxUrl = `https://${newHost}`
      
      console.log(`✅ [clone-sandbox] 新沙箱创建成功: ${newSandboxId}`)

      // 6. 在新沙箱中恢复项目
      console.log(`📥 [clone-sandbox] 在新沙箱中恢复项目...`)
      
      await newSandbox.runCode(`
import base64
import zipfile
import os

# 创建工作目录
os.chdir('/home/user')
if os.path.exists('app'):
    import shutil
    shutil.rmtree('app')
os.makedirs('app', exist_ok=True)

# 写入快照文件
zip_content = base64.b64decode("${migrationZipContent}")
with open('/tmp/migration.zip', 'wb') as f:
    f.write(zip_content)

# 解压到项目目录
os.chdir('/home/user/app')
with zipfile.ZipFile('/tmp/migration.zip', 'r') as zipf:
    zipf.extractall('/home/user/app')

print("项目文件恢复完成")
      `)

      // 7. 安装依赖并启动服务
      console.log(`🔧 [clone-sandbox] 安装依赖并启动服务...`)
      
      await newSandbox.runCode(`
import subprocess
import time
import signal
import os

os.chdir('/home/user/app')

# 快速检查 package.json
if not os.path.exists('package.json'):
    print("Warning: package.json not found, creating basic one")
    import json
    basic_package = {
        "name": "migrated-project",
        "private": True,
        "version": "0.0.0",
        "type": "module",
        "scripts": {
            "dev": "vite --host 0.0.0.0 --port 5173",
            "build": "vite build"
        },
        "dependencies": {
            "react": "^18.2.0",
            "react-dom": "^18.2.0"
        },
        "devDependencies": {
            "@vitejs/plugin-react": "^4.2.1",
            "vite": "^5.2.0"
        }
    }
    with open('package.json', 'w') as f:
        json.dump(basic_package, f, indent=2)

# 安装依赖（带超时）
print("安装依赖...")
def timeout_handler(signum, frame):
    raise TimeoutError("依赖安装超时")

signal.signal(signal.SIGALRM, timeout_handler)
signal.alarm(60)  # 60秒超时

try:
    install_result = subprocess.run(['npm', 'install'], capture_output=True, text=True)
    if install_result.returncode == 0:
        print("依赖安装成功")
    else:
        print(f"依赖安装警告: {install_result.stderr}")
except TimeoutError:
    print("依赖安装超时，继续启动服务")
except Exception as e:
    print(f"依赖安装异常: {e}")
finally:
    signal.alarm(0)

# 启动 Vite 服务器
print("启动 Vite 服务器...")
try:
    vite_process = subprocess.Popen(
        ['npm', 'run', 'dev'],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )
    time.sleep(3)  # 等待启动
    print("Vite 服务器启动完成")
except Exception as e:
    print(f"Vite 启动异常: {e}")
      `)

      // 8. 更新数据库中的项目状态
      console.log(`💾 [clone-sandbox] 更新项目状态...`)
      
      const now = new Date()
      const expiresAt = new Date(now.getTime() + appConfig.e2b.timeoutMs)

      const { error: updateError } = await supabaseServer
        .from('project_state')
        .update({
          sandbox_id: newSandboxId,
          sandbox_url: newSandboxUrl,
          sandbox_started_at: now.toISOString(),
          sandbox_expires_at: expiresAt.toISOString()
        })
        .eq('project_id', projectId)

      if (updateError) {
        console.error('❌ [clone-sandbox] 更新项目状态失败:', updateError)
        // 不阻塞迁移流程，但记录错误
      }

      // 9. 更新全局状态
      global.activeSandbox = newSandbox
      global.sandboxData = {
        sandboxId: newSandboxId,
        url: newSandboxUrl
      }

      // 10. 清理旧沙箱
      console.log(`🧹 [clone-sandbox] 清理旧沙箱...`)
      
      try {
        await oldSandbox.kill()
        console.log(`✅ [clone-sandbox] 旧沙箱清理完成`)
      } catch (error) {
        console.warn(`⚠️ [clone-sandbox] 清理旧沙箱失败: ${error}`)
      }

      // 11. 清理临时文件
      try {
        await newSandbox.runCode(`
import os
import glob

# 清理迁移临时文件
for temp_file in ['/tmp/migration.zip'] + glob.glob('/tmp/migration_snapshot_*.zip'):
    try:
        if os.path.exists(temp_file):
            os.remove(temp_file)
    except:
        pass
        `)
      } catch (error) {
        console.warn(`⚠️ [clone-sandbox] 清理临时文件失败: ${error}`)
      }

      const migrationDuration = Date.now() - startTime

      const response: SandboxCloneResponse = {
        old_sandbox_id: projectState.sandbox_id,
        new_sandbox_id: newSandboxId,
        new_sandbox_url: newSandboxUrl,
        migration_duration: migrationDuration,
        status: 'success',
        message: `沙箱迁移成功完成，耗时 ${migrationDuration}ms`
      }

      console.log(`🎉 [clone-sandbox] 迁移成功完成!`)
      console.log(`   - 旧沙箱: ${projectState.sandbox_id}`)
      console.log(`   - 新沙箱: ${newSandboxId}`)
      console.log(`   - 新URL: ${newSandboxUrl}`)
      console.log(`   - 耗时: ${migrationDuration}ms`)

      return NextResponse.json({
        success: true,
        data: response
      } as ApiResponse<SandboxCloneResponse>)

    } catch (error) {
      console.error(`❌ [clone-sandbox] 新沙箱创建/恢复失败: ${error}`)
      
      // 清理新沙箱（如果已创建）
      if (newSandbox) {
        try {
          await newSandbox.kill()
        } catch (cleanupError) {
          console.warn(`⚠️ [clone-sandbox] 清理新沙箱失败: ${cleanupError}`)
        }
      }

      const migrationDuration = Date.now() - startTime

      const response: SandboxCloneResponse = {
        old_sandbox_id: projectState.sandbox_id,
        new_sandbox_id: '',
        new_sandbox_url: '',
        migration_duration: migrationDuration,
        status: 'failed',
        message: `沙箱迁移失败: ${error instanceof Error ? error.message : String(error)}`
      }

      return NextResponse.json({
        success: false,
        error: {
          error: 'MIGRATION_FAILED',
          message: '沙箱迁移失败',
          details: response
        }
      } as ApiResponse, { status: 500 })
    }

  } catch (error) {
    console.error('❌ [clone-sandbox] 沙箱迁移异常:', error)

    // 紧急清理
    const cleanupPromises = []
    
    if (oldSandbox) {
      cleanupPromises.push(
        oldSandbox.kill().catch((e: any) => 
          console.warn(`清理旧沙箱失败: ${e}`)
        )
      )
    }
    
    if (newSandbox) {
      cleanupPromises.push(
        newSandbox.kill().catch((e: any) => 
          console.warn(`清理新沙箱失败: ${e}`)
        )
      )
    }

    await Promise.allSettled(cleanupPromises)

    const migrationDuration = Date.now() - startTime

    return NextResponse.json({
      success: false,
      error: {
        error: 'INTERNAL_ERROR',
        message: '沙箱迁移异常',
        details: {
          error: error instanceof Error ? error.message : String(error),
          duration: migrationDuration
        }
      }
    } as ApiResponse, { status: 500 })
  }
}
