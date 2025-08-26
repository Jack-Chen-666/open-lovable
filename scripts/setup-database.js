import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 使用环境变量或硬编码值
const supabaseUrl = process.env.SUPABASE_URL || 'https://qutmwznbbypvpurqtmvx.supabase.co'
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1dG13em5iYnlwdnB1cnF0bXZ4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NjE0MjA3NywiZXhwIjoyMDcxNzE4MDc3fQ.TdWnWQpQDpCDWfF4DTT-XJ5RT7G2ZqakCdyDFy4U9fQ'

console.log('🚀 开始设置数据库...')

const supabase = createClient(supabaseUrl, supabaseServiceRole, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

async function createTables() {
  console.log('📋 创建 projects 表...')
  
  // 创建 projects 表
  const { error: projectsError } = await supabase.rpc('exec', {
    query: `
      CREATE TABLE IF NOT EXISTS public.projects (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        visibility TEXT NOT NULL DEFAULT 'private',
        model TEXT NOT NULL DEFAULT 'moonshotai/kimi-k2-instruct',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_opened_at TIMESTAMPTZ
      );
    `
  })
  
  if (projectsError) {
    console.log('⚠️ projects 表可能已存在或创建遇到问题:', projectsError)
  }
  
  console.log('📋 创建 project_state 表...')
  
  // 创建 project_state 表
  const { error: stateError } = await supabase.rpc('exec', {
    query: `
      CREATE TABLE IF NOT EXISTS public.project_state (
        project_id UUID PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
        sandbox_id TEXT,
        sandbox_url TEXT,
        sandbox_started_at TIMESTAMPTZ,
        sandbox_expires_at TIMESTAMPTZ,
        last_snapshot_id UUID
      );
    `
  })
  
  if (stateError) {
    console.log('⚠️ project_state 表可能已存在或创建遇到问题:', stateError)
  }
  
  console.log('📋 创建 project_snapshots 表...')
  
  // 创建 project_snapshots 表
  const { error: snapshotsError } = await supabase.rpc('exec', {
    query: `
      CREATE TABLE IF NOT EXISTS public.project_snapshots (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
        storage_key TEXT NOT NULL,
        size_bytes BIGINT,
        sha256 TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `
  })
  
  if (snapshotsError) {
    console.log('⚠️ project_snapshots 表可能已存在或创建遇到问题:', snapshotsError)
  }
  
  console.log('📋 创建 project_manifests 表...')
  
  // 创建 project_manifests 表
  const { error: manifestsError } = await supabase.rpc('exec', {
    query: `
      CREATE TABLE IF NOT EXISTS public.project_manifests (
        project_id UUID PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
        manifest JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `
  })
  
  if (manifestsError) {
    console.log('⚠️ project_manifests 表可能已存在或创建遇到问题:', manifestsError)
  }
}

async function setupDatabase() {
  try {
    console.log('📝 创建数据库表结构...')
    
    // 直接执行创建表的操作
    await createTables()
    
    console.log('✅ 数据库表结构创建成功')
    
    // 验证表是否创建成功
    const { data: tables, error: tableError } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_schema', 'public')
      .in('table_name', ['projects', 'project_state', 'project_snapshots', 'project_manifests'])
    
    if (tableError) {
      console.error('❌ 验证表结构失败:', tableError)
      return false
    }
    
    console.log('📋 创建的表:', tables?.map(t => t.table_name))
    
    // 创建 Storage buckets
    await createStorageBuckets()
    
    return true
    
  } catch (error) {
    console.error('❌ 设置过程中发生错误:', error)
    return false
  }
}

async function createStorageBuckets() {
  console.log('🗄️ 创建 Storage buckets...')
  
  // 创建 project-zips bucket
  const { data: zipsBucket, error: zipsError } = await supabase.storage.createBucket('project-zips', {
    public: false,
    allowedMimeTypes: ['application/zip', 'application/x-zip-compressed'],
    fileSizeLimit: 104857600 // 100MB
  })
  
  if (zipsError && !zipsError.message.includes('already exists')) {
    console.error('❌ 创建 project-zips bucket 失败:', zipsError)
  } else {
    console.log('✅ project-zips bucket 创建成功')
  }
  
  // 创建 project-screenshots bucket
  const { data: screenshotsBucket, error: screenshotsError } = await supabase.storage.createBucket('project-screenshots', {
    public: true,
    allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
    fileSizeLimit: 10485760 // 10MB
  })
  
  if (screenshotsError && !screenshotsError.message.includes('already exists')) {
    console.error('❌ 创建 project-screenshots bucket 失败:', screenshotsError)
  } else {
    console.log('✅ project-screenshots bucket 创建成功')
  }
}

// 如果直接运行此文件，执行设置
if (import.meta.url === `file://${process.argv[1]}`) {
  setupDatabase().then(success => {
    if (success) {
      console.log('🎉 数据库设置完成！')
      process.exit(0)
    } else {
      console.log('💥 数据库设置失败！')
      process.exit(1)
    }
  })
}

export { setupDatabase }
