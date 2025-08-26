import { NextRequest, NextResponse } from 'next/server'
import { Sandbox } from '@e2b/code-interpreter'
import { supabaseServer } from '@/lib/supabase/server'
import { appConfig } from '@/config/app.config'
import {
  Project,
  ProjectOpenResponse,
  ProjectState,
  ProjectSnapshot,
  ApiResponse
} from '@/types/project'

declare global {
  var activeSandbox: any;
  var sandboxData: any;
  var existingFiles: Set<string>;
  var sandboxState: any;
}

/**
 * POST /api/projects/[id]/open - 打开项目（确保沙箱可用）
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

    console.log(`🚀 [project-open] 打开项目: ${projectId}`)

    // 1. 验证项目是否存在
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

      console.error('❌ [project-open] 获取项目失败:', projectError)
      return NextResponse.json({
        success: false,
        error: {
          error: 'DATABASE_ERROR',
          message: '获取项目失败',
          details: projectError
        }
      } as ApiResponse, { status: 500 })
    }

    // 2. 获取项目当前状态
    const { data: projectState, error: stateError } = await supabaseServer
      .from('project_state')
      .select('*')
      .eq('project_id', projectId)
      .single()

    if (stateError && stateError.code !== 'PGRST116') {
      console.warn('⚠️ [project-open] 获取项目状态失败:', stateError)
    }

    let sandbox: any = null
    let sandboxUrl: string = ''
    let status: 'existing' | 'created' | 'restored' = 'created'
    let message = ''

    // 3. 尝试连接现有沙箱
    if (projectState?.sandbox_id) {
      console.log(`🔗 [project-open] 尝试连接现有沙箱: ${projectState.sandbox_id}`)
      
      try {
        // 检查沙箱是否还有效
        sandbox = await Sandbox.connect(projectState.sandbox_id, {
          apiKey: process.env.E2B_API_KEY
        })

        // 检查是否即将过期（剩余时间小于2分钟）
        const expiresAt = new Date(projectState.sandbox_expires_at || 0)
        const now = new Date()
        const timeLeft = expiresAt.getTime() - now.getTime()
        const twoMinutes = 2 * 60 * 1000

        if (timeLeft > twoMinutes) {
          // 沙箱仍然有效且时间充足
          const host = (sandbox as any).getHost(appConfig.e2b.vitePort)
          sandboxUrl = `https://${host}`
          status = 'existing'
          message = '成功连接到现有沙箱'
          
          console.log(`✅ [project-open] 连接现有沙箱成功: ${sandboxUrl}`)
        } else {
          // 沙箱即将过期，需要创建新的
          console.log(`⏰ [project-open] 沙箱即将过期，创建新沙箱`)
          await sandbox.kill()
          sandbox = null
        }
      } catch (error) {
        console.log(`❌ [project-open] 连接现有沙箱失败: ${error}`)
        sandbox = null
      }
    }

    // 4. 如果没有有效的沙箱，创建新的
    if (!sandbox) {
      console.log(`🔨 [project-open] 创建新沙箱...`)
      
      // 清理旧的全局状态
      if (global.activeSandbox) {
        try {
          await global.activeSandbox.kill()
        } catch (e) {
          console.warn('清理旧沙箱失败:', e)
        }
      }

      // 创建新沙箱
      sandbox = await Sandbox.create({
        apiKey: process.env.E2B_API_KEY,
        timeoutMs: appConfig.e2b.timeoutMs
      })

      const sandboxId = (sandbox as any).sandboxId || Date.now().toString()
      const host = (sandbox as any).getHost(appConfig.e2b.vitePort)
      sandboxUrl = `https://${host}`
      
      console.log(`✅ [project-open] 新沙箱创建成功: ${sandboxId}`)

      // 5. 检查是否有快照需要恢复
      const { data: latestSnapshot, error: snapshotError } = await supabaseServer
        .from('project_snapshots')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      if (latestSnapshot && !snapshotError) {
        console.log(`📦 [project-open] 发现快照，开始恢复: ${latestSnapshot.storage_key}`)
        
        try {
          // 从 Supabase Storage 下载快照
          const { data: zipData, error: downloadError } = await supabaseServer.storage
            .from('project-zips')
            .download(latestSnapshot.storage_key)

          if (downloadError) {
            console.error('❌ 下载快照失败:', downloadError)
            throw new Error('下载快照失败')
          }

          // 将 ZIP 文件上传到沙箱并解压
          const arrayBuffer = await zipData.arrayBuffer()
          const base64Content = Buffer.from(arrayBuffer).toString('base64')
          
          await sandbox.runCode(`
import base64
import zipfile
import os

# 写入 ZIP 文件
zip_content = base64.b64decode("${base64Content}")
with open('/tmp/project.zip', 'wb') as f:
    f.write(zip_content)

# 清理现有文件（保留基础配置）
os.chdir('/home/user')
if os.path.exists('app'):
    import shutil
    shutil.rmtree('app')
os.makedirs('app', exist_ok=True)
os.chdir('/home/user/app')

# 解压项目文件
with zipfile.ZipFile('/tmp/project.zip', 'r') as zipf:
    zipf.extractall('/home/user/app')

print("项目快照恢复完成")
          `)

          // 安装依赖并启动 Vite
          await sandbox.runCode(`
import subprocess
import os

os.chdir('/home/user/app')

# 安装依赖
print("安装依赖...")
install_result = subprocess.run(['npm', 'install'], capture_output=True, text=True)
if install_result.returncode == 0:
    print("依赖安装成功")
else:
    print(f"依赖安装警告: {install_result.stderr}")

# 启动 Vite 开发服务器
print("启动 Vite 服务器...")
import signal
def timeout_handler(signum, frame):
    raise TimeoutError()

signal.signal(signal.SIGALRM, timeout_handler)
signal.alarm(30)  # 30秒超时

try:
    vite_result = subprocess.Popen(['npm', 'run', 'dev'], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    print("Vite 服务器启动中...")
except TimeoutError:
    print("Vite 启动超时，但进程已启动")
finally:
    signal.alarm(0)
          `)

          status = 'restored'
          message = '从快照恢复项目成功'
          console.log(`✅ [project-open] 快照恢复成功`)
          
        } catch (error) {
          console.error('❌ [project-open] 快照恢复失败:', error)
          // 快照恢复失败，创建基础 Vite 环境
          await createBaseViteEnvironment(sandbox)
          status = 'created'
          message = '快照恢复失败，创建了新的基础环境'
        }
      } else {
        // 没有快照，创建基础 Vite 环境
        console.log(`🎯 [project-open] 创建基础 Vite 环境`)
        await createBaseViteEnvironment(sandbox)
        status = 'created'
        message = '创建新项目环境成功'
      }

      // 6. 更新项目状态到数据库
      const now = new Date()
      const expiresAt = new Date(now.getTime() + appConfig.e2b.timeoutMs)

      const stateUpdate = {
        project_id: projectId,
        sandbox_id: sandboxId,
        sandbox_url: sandboxUrl,
        sandbox_started_at: now.toISOString(),
        sandbox_expires_at: expiresAt.toISOString(),
        last_snapshot_id: latestSnapshot?.id || null
      }

      const { error: updateError } = await supabaseServer
        .from('project_state')
        .upsert(stateUpdate, { onConflict: 'project_id' })

      if (updateError) {
        console.error('❌ [project-open] 更新项目状态失败:', updateError)
        // 不阻塞响应，但记录错误
      }

      // 7. 更新项目的最后打开时间
      await supabaseServer
        .from('projects')
        .update({ last_opened_at: now.toISOString() })
        .eq('id', projectId)
    }

    // 8. 设置全局状态（保持与现有代码的兼容性）
    global.activeSandbox = sandbox
    global.sandboxData = {
      sandboxId: projectState?.sandbox_id || (sandbox as any).sandboxId,
      url: sandboxUrl
    }
    
    if (!global.existingFiles) {
      global.existingFiles = new Set<string>()
    }

    const response: ProjectOpenResponse = {
      project_id: projectId,
      sandbox_id: projectState?.sandbox_id || (sandbox as any).sandboxId,
      sandbox_url: sandboxUrl,
      status,
      message
    }

    console.log(`🎉 [project-open] 项目打开成功: ${project.name}`)

    return NextResponse.json({
      success: true,
      data: response
    } as ApiResponse<ProjectOpenResponse>)

  } catch (error) {
    console.error('❌ [project-open] 打开项目异常:', error)
    return NextResponse.json({
      success: false,
      error: {
        error: 'INTERNAL_ERROR',
        message: '打开项目失败',
        details: error instanceof Error ? error.message : String(error)
      }
    } as ApiResponse, { status: 500 })
  }
}

/**
 * 创建基础 Vite 环境（复用现有逻辑）
 */
async function createBaseViteEnvironment(sandbox: any) {
  console.log('[project-open] 设置基础 Vite React 应用...')
  
  // 使用与 create-ai-sandbox 相同的逻辑创建基础文件
  await sandbox.runCode(`
import os
import json

# 确保在正确的目录
os.chdir('/home/user')
if not os.path.exists('app'):
    os.makedirs('app')
os.chdir('/home/user/app')

# 创建 package.json
package_json = {
    "name": "vite-react-app",
    "private": True,
    "version": "0.0.0",
    "type": "module",
    "scripts": {
        "dev": "vite --host 0.0.0.0 --port 5173",
        "build": "vite build",
        "lint": "eslint . --ext js,jsx --report-unused-disable-directives --max-warnings 0",
        "preview": "vite preview"
    },
    "dependencies": {
        "react": "^18.2.0",
        "react-dom": "^18.2.0"
    },
    "devDependencies": {
        "@types/react": "^18.2.66",
        "@types/react-dom": "^18.2.22",
        "@vitejs/plugin-react": "^4.2.1",
        "autoprefixer": "^10.4.19",
        "eslint": "^8.57.0",
        "eslint-plugin-react": "^7.34.1",
        "eslint-plugin-react-hooks": "^4.6.0",
        "eslint-plugin-react-refresh": "^0.4.6",
        "postcss": "^8.4.38",
        "tailwindcss": "^3.4.4",
        "vite": "^5.2.0"
    }
}

with open('package.json', 'w') as f:
    json.dump(package_json, f, indent=2)

print("Created package.json")
  `)

  // 创建基础文件结构
  await sandbox.runCode(`
# 创建 index.html
index_html = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vite + React</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>"""

with open('index.html', 'w') as f:
    f.write(index_html)

# 创建 src 目录
os.makedirs('src', exist_ok=True)

# 创建 main.jsx
main_jsx = """import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)"""

with open('src/main.jsx', 'w') as f:
    f.write(main_jsx)

# 创建 App.jsx
app_jsx = """import { useState } from 'react'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <div className="bg-white p-8 rounded-lg shadow-md">
        <h1 className="text-3xl font-bold text-gray-800 mb-4">Vite + React</h1>
        <div className="text-center">
          <button
            onClick={() => setCount((count) => count + 1)}
            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
          >
            count is {count}
          </button>
          <p className="mt-4 text-gray-600">
            Edit <code className="bg-gray-200 px-1 rounded">src/App.jsx</code> and save to test HMR
          </p>
        </div>
      </div>
    </div>
  )
}

export default App"""

with open('src/App.jsx', 'w') as f:
    f.write(app_jsx)

# 创建 index.css with Tailwind
index_css = """@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  font-family: Inter, system-ui, Avenir, Helvetica, Arial, sans-serif;
  line-height: 1.5;
  font-weight: 400;
  color-scheme: light;
  
  color: rgba(0, 0, 0, 0.87);
  background-color: #ffffff;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
}"""

with open('src/index.css', 'w') as f:
    f.write(index_css)

print("Created basic React files")
  `)

  // 创建配置文件
  await sandbox.runCode(`
# 创建 vite.config.js
vite_config = """import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173
  }
})"""

with open('vite.config.js', 'w') as f:
    f.write(vite_config)

# 创建 tailwind.config.js
tailwind_config = """/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}"""

with open('tailwind.config.js', 'w') as f:
    f.write(tailwind_config)

# 创建 postcss.config.js
postcss_config = """export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}"""

with open('postcss.config.js', 'w') as f:
    f.write(postcss_config)

print("Created configuration files")
  `)

  // 安装依赖并启动服务器
  await sandbox.runCode(`
import subprocess
import time

# 安装依赖
print("Installing dependencies...")
install_result = subprocess.run(['npm', 'install'], capture_output=True, text=True, timeout=120)

if install_result.returncode == 0:
    print("Dependencies installed successfully")
else:
    print(f"Install completed with warnings: {install_result.stderr}")

# 启动 Vite 开发服务器（后台运行）
print("Starting Vite dev server...")
dev_process = subprocess.Popen(
    ['npm', 'run', 'dev'],
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    cwd='/home/user/app'
)

# 等待服务器启动
time.sleep(5)
print("Vite dev server started")
  `)

  console.log('[project-open] ✅ 基础 Vite 环境创建完成')
}
