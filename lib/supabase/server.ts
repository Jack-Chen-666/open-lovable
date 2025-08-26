import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL!
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE!

if (!supabaseUrl || !supabaseServiceRole) {
  throw new Error('Missing Supabase environment variables')
}

/**
 * Supabase 服务端客户端
 * 使用 service_role 密钥，拥有完整的数据库访问权限
 * 仅在服务端使用，不要暴露到浏览器端
 */
export const supabaseServer = createClient(supabaseUrl, supabaseServiceRole, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

export default supabaseServer
