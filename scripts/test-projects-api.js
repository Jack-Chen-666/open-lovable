/**
 * 项目 CRUD API 测试脚本
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
 * 测试创建项目
 */
async function testCreateProject() {
  console.log('\n=== 测试创建项目 ===')
  
  const { response, data, error } = await makeRequest('POST', '/api/projects', {
    name: '测试项目 - API Test',
    model: 'moonshotai/kimi-k2-instruct',
    visibility: 'private'
  })

  if (error) {
    console.error('❌ 创建项目失败:', error)
    return false
  }

  if (response.status === 201 && data.success && data.data) {
    testProjectId = data.data.id
    console.log('✅ 创建项目成功, ID:', testProjectId)
    return true
  } else {
    console.error('❌ 创建项目失败，响应异常')
    return false
  }
}

/**
 * 测试获取项目列表
 */
async function testGetProjects() {
  console.log('\n=== 测试获取项目列表 ===')
  
  const { response, data, error } = await makeRequest('GET', '/api/projects?limit=10&sort_order=desc')

  if (error) {
    console.error('❌ 获取项目列表失败:', error)
    return false
  }

  if (response.status === 200 && data.success && data.data) {
    console.log(`✅ 获取项目列表成功, 共 ${data.data.projects.length} 个项目`)
    console.log('项目列表:', data.data.projects.map(p => `${p.name} (${p.id})`))
    return true
  } else {
    console.error('❌ 获取项目列表失败，响应异常')
    return false
  }
}

/**
 * 测试获取项目详情
 */
async function testGetProjectDetail() {
  if (!testProjectId) {
    console.log('\n⚠️ 跳过获取项目详情测试 - 没有测试项目ID')
    return true
  }

  console.log('\n=== 测试获取项目详情 ===')
  
  const { response, data, error } = await makeRequest('GET', `/api/projects/${testProjectId}`)

  if (error) {
    console.error('❌ 获取项目详情失败:', error)
    return false
  }

  if (response.status === 200 && data.success && data.data) {
    console.log('✅ 获取项目详情成功')
    console.log('项目信息:', {
      id: data.data.id,
      name: data.data.name,
      model: data.data.model,
      visibility: data.data.visibility
    })
    return true
  } else {
    console.error('❌ 获取项目详情失败，响应异常')
    return false
  }
}

/**
 * 测试更新项目
 */
async function testUpdateProject() {
  if (!testProjectId) {
    console.log('\n⚠️ 跳过更新项目测试 - 没有测试项目ID')
    return true
  }

  console.log('\n=== 测试更新项目 ===')
  
  const { response, data, error } = await makeRequest('PATCH', `/api/projects/${testProjectId}`, {
    name: '测试项目 - 已更新'
  })

  if (error) {
    console.error('❌ 更新项目失败:', error)
    return false
  }

  if (response.status === 200 && data.success && data.data) {
    console.log('✅ 更新项目成功')
    console.log('更新后的项目名称:', data.data.name)
    return true
  } else {
    console.error('❌ 更新项目失败，响应异常')
    return false
  }
}

/**
 * 测试删除项目
 */
async function testDeleteProject() {
  if (!testProjectId) {
    console.log('\n⚠️ 跳过删除项目测试 - 没有测试项目ID')
    return true
  }

  console.log('\n=== 测试删除项目 ===')
  
  const { response, data, error } = await makeRequest('DELETE', `/api/projects/${testProjectId}`)

  if (error) {
    console.error('❌ 删除项目失败:', error)
    return false
  }

  if (response.status === 200 && data.success) {
    console.log('✅ 删除项目成功')
    testProjectId = null
    return true
  } else {
    console.error('❌ 删除项目失败，响应异常')
    return false
  }
}

/**
 * 测试错误情况
 */
async function testErrorCases() {
  console.log('\n=== 测试错误情况 ===')
  
  let passedTests = 0
  let totalTests = 0

  // 测试创建空名称项目
  totalTests++
  console.log('\n📝 测试创建空名称项目')
  const { response: r1, data: d1 } = await makeRequest('POST', '/api/projects', {
    name: ''
  })
  if (r1.status === 400 && !d1.success) {
    console.log('✅ 正确拒绝空名称')
    passedTests++
  } else {
    console.log('❌ 应该拒绝空名称')
  }

  // 测试获取不存在的项目
  totalTests++
  console.log('\n📝 测试获取不存在的项目')
  const { response: r2, data: d2 } = await makeRequest('GET', '/api/projects/non-existent-id')
  if (r2.status === 404 && !d2.success) {
    console.log('✅ 正确返回404')
    passedTests++
  } else {
    console.log('❌ 应该返回404')
  }

  console.log(`\n📊 错误情况测试: ${passedTests}/${totalTests} 通过`)
  return passedTests === totalTests
}

/**
 * 运行所有测试
 */
async function runAllTests() {
  console.log('🚀 开始项目 CRUD API 测试')
  console.log('📡 测试服务器:', BASE_URL)

  const tests = [
    { name: '创建项目', fn: testCreateProject },
    { name: '获取项目列表', fn: testGetProjects },
    { name: '获取项目详情', fn: testGetProjectDetail },
    { name: '更新项目', fn: testUpdateProject },
    { name: '删除项目', fn: testDeleteProject },
    { name: '错误情况', fn: testErrorCases }
  ]

  let passedTests = 0
  let totalTests = tests.length

  for (const test of tests) {
    try {
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
  }

  console.log(`\n📊 测试结果: ${passedTests}/${totalTests} 通过`)
  
  if (passedTests === totalTests) {
    console.log('🎉 所有测试通过！')
    process.exit(0)
  } else {
    console.log('💥 部分测试失败！')
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
