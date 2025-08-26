/**
 * 简单的 API 测试
 */

async function testAPI() {
  try {
    console.log('🔗 测试 API 连接...')
    
    const response = await fetch('http://localhost:3000/api/projects', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    })

    console.log('Status:', response.status)
    
    const data = await response.json()
    console.log('Response:', JSON.stringify(data, null, 2))

    if (response.status === 200) {
      console.log('✅ API 测试成功')
    } else {
      console.log('❌ API 返回错误状态')
    }

  } catch (error) {
    console.error('❌ API 测试失败:', error)
  }
}

testAPI()
