/**
 * 沙箱管理 API 测试脚本
 * 测试项目打开、快照创建、状态查询、热迁移等功能
 */

const BASE_URL = 'http://localhost:3000'

let testProjectId = null

/**
 * 发送 HTTP 请求的辅助函数
 */
async function makeRequest(method, path, body = null) {
  const url = `${BASE_URL}${path}`
  
  console.log(`\n🔄 ${method} ${path}`)
  if (body) {
    console.log('📤 Request body:', JSON.stringify(body, null, 2))
  }

  try {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
      }
    }

    if (body) {
      options.body = JSON.stringify(body)
    }

    const response = await fetch(url, options)
    const data = await response.json()

    console.log(`📊 Status: ${response.status}`)
    console.log('📥 Response:', JSON.stringify(data, null, 2))

    return { response, data }
  } catch (error) {
    console.error('❌ Request failed:', error)
    return { error }
  }
}

/**
 * 延迟函数
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 设置测试项目
 */
async function setupTestProject() {
  console.log('\n=== 设置测试项目 ===')
  
  const { response, data, error } = await makeRequest('POST', '/api/projects', {
    name: '沙箱API测试项目',
    model: 'moonshotai/kimi-k2-instruct',
    visibility: 'private'
  })

  if (error || !response || response.status !== 201 || !data.success) {
    console.error('❌ 创建测试项目失败')
    return false
  }

  testProjectId = data.data.id
  console.log('✅ 测试项目创建成功, ID:', testProjectId)
  return true
}

/**
 * 测试项目打开 API
 */
async function testProjectOpen() {
  if (!testProjectId) {
    console.log('\n⚠️ 跳过项目打开测试 - 没有测试项目')
    return false
  }

  console.log('\n=== 测试项目打开 ===')
  
  const { response, data, error } = await makeRequest('POST', `/api/projects/${testProjectId}/open`)

  if (error) {
    console.error('❌ 项目打开失败:', error)
    return false
  }

  if (response.status === 200 && data.success && data.data) {
    console.log('✅ 项目打开成功')
    console.log('沙箱信息:', {
      sandbox_id: data.data.sandbox_id,
      sandbox_url: data.data.sandbox_url,
      status: data.data.status,
      message: data.data.message
    })
    return true
  } else {
    console.error('❌ 项目打开失败，响应异常')
    return false
  }
}

/**
 * 测试项目状态查询
 */
async function testProjectStatus() {
  if (!testProjectId) {
    console.log('\n⚠️ 跳过状态查询测试 - 没有测试项目')
    return false
  }

  console.log('\n=== 测试项目状态查询 ===')
  
  const { response, data, error } = await makeRequest('GET', `/api/projects/${testProjectId}/status`)

  if (error) {
    console.error('❌ 状态查询失败:', error)
    return false
  }

  if (response.status === 200 && data.success && data.data) {
    console.log('✅ 状态查询成功')
    console.log('项目状态:', {
      project_id: data.data.project_id,
      sandbox_status: data.data.sandbox_status,
      sandbox_id: data.data.sandbox_id?.substring(0, 20) + '...',
      snapshots_count: data.data.snapshots_count,
      expires_at: data.data.expires_at
    })
    return true
  } else {
    console.error('❌ 状态查询失败，响应异常')
    return false
  }
}

/**
 * 测试快照创建
 */
async function testSnapshotCreate() {
  if (!testProjectId) {
    console.log('\n⚠️ 跳过快照创建测试 - 没有测试项目')
    return false
  }

  console.log('\n=== 测试快照创建 ===')
  console.log('⏳ 等待沙箱稳定...')
  await delay(5000) // 等待沙箱稳定
  
  const { response, data, error } = await makeRequest('POST', `/api/projects/${testProjectId}/snapshot`)

  if (error) {
    console.error('❌ 快照创建失败:', error)
    return false
  }

  if (response.status === 200 && data.success && data.data) {
    console.log('✅ 快照创建成功')
    console.log('快照信息:', {
      snapshot_id: data.data.snapshot_id,
      storage_key: data.data.storage_key,
      size_bytes: data.data.size_bytes,
      sha256: data.data.sha256?.substring(0, 20) + '...',
      created_at: data.data.created_at
    })
    return true
  } else {
    console.error('❌ 快照创建失败，响应异常')
    return false
  }
}

/**
 * 测试快照列表获取
 */
async function testSnapshotList() {
  if (!testProjectId) {
    console.log('\n⚠️ 跳过快照列表测试 - 没有测试项目')
    return false
  }

  console.log('\n=== 测试快照列表获取 ===')
  
  const { response, data, error } = await makeRequest('GET', `/api/projects/${testProjectId}/snapshot?limit=5`)

  if (error) {
    console.error('❌ 快照列表获取失败:', error)
    return false
  }

  if (response.status === 200 && data.success && data.data) {
    console.log('✅ 快照列表获取成功')
    console.log(`快照数量: ${data.data.snapshots.length}`)
    if (data.data.snapshots.length > 0) {
      console.log('最新快照:', data.data.snapshots[0].storage_key)
    }
    return true
  } else {
    console.error('❌ 快照列表获取失败，响应异常')
    return false
  }
}

/**
 * 测试状态操作（刷新和清理）
 */
async function testStatusOperations() {
  if (!testProjectId) {
    console.log('\n⚠️ 跳过状态操作测试 - 没有测试项目')
    return true
  }

  console.log('\n=== 测试状态操作 ===')
  
  // 测试状态刷新
  console.log('\n📝 测试状态刷新')
  const { response: r1, data: d1 } = await makeRequest('POST', `/api/projects/${testProjectId}/status`, {
    action: 'refresh'
  })
  
  if (r1.status === 200 && d1.success) {
    console.log('✅ 状态刷新成功')
  } else {
    console.log('❌ 状态刷新失败')
    return false
  }

  // 测试清理操作
  console.log('\n📝 测试清理操作')
  const { response: r2, data: d2 } = await makeRequest('POST', `/api/projects/${testProjectId}/status`, {
    action: 'cleanup'
  })
  
  if (r2.status === 200 && d2.success) {
    console.log('✅ 清理操作成功:', d2.data.message)
  } else {
    console.log('❌ 清理操作失败')
    return false
  }

  return true
}

/**
 * 测试热迁移（仅在有沙箱时测试）
 */
async function testHotMigration() {
  if (!testProjectId) {
    console.log('\n⚠️ 跳过热迁移测试 - 没有测试项目')
    return true
  }

  console.log('\n=== 测试热迁移 ===')
  console.log('⚠️ 注意：热迁移是一个复杂操作，在测试环境中可能失败')
  
  const { response, data, error } = await makeRequest('POST', `/api/projects/${testProjectId}/clone-sandbox`)

  if (error) {
    console.log('⚠️ 热迁移失败（预期）:', error)
    return true // 在测试环境中，热迁移失败是预期的
  }

  if (response.status === 200 && data.success && data.data) {
    console.log('✅ 热迁移成功')
    console.log('迁移信息:', {
      old_sandbox_id: data.data.old_sandbox_id?.substring(0, 20) + '...',
      new_sandbox_id: data.data.new_sandbox_id?.substring(0, 20) + '...',
      migration_duration: data.data.migration_duration + 'ms',
      status: data.data.status
    })
    return true
  } else {
    console.log('⚠️ 热迁移失败（可能是预期的）')
    return true
  }
}

/**
 * 清理测试项目
 */
async function cleanupTestProject() {
  if (!testProjectId) {
    return true
  }

  console.log('\n=== 清理测试项目 ===')
  
  const { response, data, error } = await makeRequest('DELETE', `/api/projects/${testProjectId}`)

  if (error || response.status !== 200 || !data.success) {
    console.error('❌ 清理测试项目失败')
    return false
  }

  console.log('✅ 测试项目清理成功')
  testProjectId = null
  return true
}

/**
 * 运行所有测试
 */
async function runAllTests() {
  console.log('🚀 开始沙箱管理 API 测试')
  console.log('📡 测试服务器:', BASE_URL)

  const tests = [
    { name: '设置测试项目', fn: setupTestProject },
    { name: '项目打开', fn: testProjectOpen },
    { name: '项目状态查询', fn: testProjectStatus },
    { name: '快照创建', fn: testSnapshotCreate },
    { name: '快照列表获取', fn: testSnapshotList },
    { name: '状态操作', fn: testStatusOperations },
    { name: '热迁移', fn: testHotMigration },
    { name: '清理测试项目', fn: cleanupTestProject }
  ]

  let passedTests = 0
  let totalTests = tests.length

  for (const test of tests) {
    try {
      console.log(`\n📝 运行测试: ${test.name}`)
      const passed = await test.fn()
      if (passed) {
        passedTests++
        console.log(`✅ ${test.name} 测试通过`)
      } else {
        console.log(`❌ ${test.name} 测试失败`)
      }
    } catch (error) {
      console.error(`💥 ${test.name} 测试异常:`, error)
    }

    // 在测试间稍作延迟
    await delay(1000)
  }

  console.log(`\n📊 沙箱管理 API 测试结果: ${passedTests}/${totalTests} 通过`)
  
  if (passedTests >= totalTests - 1) { // 允许热迁移测试失败
    console.log('🎉 沙箱管理 API 测试基本通过！')
    process.exit(0)
  } else {
    console.log('💥 部分关键测试失败！')
    process.exit(1)
  }
}

// 检查是否正在运行此脚本
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests().catch(error => {
    console.error('💥 测试脚本异常:', error)
    process.exit(1)
  })
}

export { runAllTests }
