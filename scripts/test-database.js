import { createClient } from '@supabase/supabase-js'

// 使用环境变量或硬编码值
const supabaseUrl = process.env.SUPABASE_URL || 'https://qutmwznbbypvpurqtmvx.supabase.co'
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1dG13em5iYnlwdnB1cnF0bXZ4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NjE0MjA3NywiZXhwIjoyMDcxNzE4MDc3fQ.TdWnWQpQDpCDWfF4DTT-XJ5RT7G2ZqakCdyDFy4U9fQ'

console.log('🔗 测试 Supabase 连接...')

const supabase = createClient(supabaseUrl, supabaseServiceRole, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

async function testConnection() {
  try {
    // 测试连接 - 尝试一个简单的查询
    console.log('✅ Supabase 客户端初始化成功')
    
    // 尝试查询现有表（如果表不存在会报错，这是预期的）
    console.log('📋 检查现有表结构...')
    
    // 检查 projects 表是否存在
    const { data: projectsData, error: projectsError } = await supabase
      .from('projects')
      .select('*')
      .limit(1)
    
    if (!projectsError) {
      console.log('✅ projects 表已存在')
    } else if (projectsError.code === 'PGRST106') {
      console.log('⚠️ projects 表不存在')
    } else {
      console.log('⚠️ projects 表查询错误:', projectsError.message)
    }
    
    // 检查 project_state 表是否存在
    const { data: stateData, error: stateError } = await supabase
      .from('project_state')
      .select('*')
      .limit(1)
    
    if (!stateError) {
      console.log('✅ project_state 表已存在')
    } else if (stateError.code === 'PGRST106') {
      console.log('⚠️ project_state 表不存在')
    } else {
      console.log('⚠️ project_state 表查询错误:', stateError.message)
    }
    
    // 检查 project_snapshots 表是否存在
    const { data: snapshotsData, error: snapshotsError } = await supabase
      .from('project_snapshots')
      .select('*')
      .limit(1)
    
    if (!snapshotsError) {
      console.log('✅ project_snapshots 表已存在')
    } else if (snapshotsError.code === 'PGRST106') {
      console.log('⚠️ project_snapshots 表不存在')
    } else {
      console.log('⚠️ project_snapshots 表查询错误:', snapshotsError.message)
    }
    
    // 检查 project_manifests 表是否存在
    const { data: manifestsData, error: manifestsError } = await supabase
      .from('project_manifests')
      .select('*')
      .limit(1)
    
    if (!manifestsError) {
      console.log('✅ project_manifests 表已存在')
    } else if (manifestsError.code === 'PGRST106') {
      console.log('⚠️ project_manifests 表不存在')
    } else {
      console.log('⚠️ project_manifests 表查询错误:', manifestsError.message)
    }
    
    // 测试 Storage buckets
    const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets()
    
    if (bucketsError) {
      console.log('⚠️ 无法查询 Storage buckets:', bucketsError)
    } else {
      const bucketNames = buckets?.map(b => b.name) || []
      console.log('🗄️ 现有 Storage buckets:', bucketNames)
      
      const requiredBuckets = ['project-zips', 'project-screenshots']
      const missingBuckets = requiredBuckets.filter(name => !bucketNames.includes(name))
      
      if (missingBuckets.length === 0) {
        console.log('✅ 所有必需的 Storage buckets 都已存在')
      } else {
        console.log('⚠️ 需要创建的 buckets:', missingBuckets)
      }
    }
    
    return true
    
  } catch (error) {
    console.error('❌ 测试过程中发生错误:', error)
    return false
  }
}

// 运行测试
testConnection().then(success => {
  if (success) {
    console.log('🎉 数据库连接测试完成！')
  } else {
    console.log('💥 数据库连接测试失败！')
  }
})
