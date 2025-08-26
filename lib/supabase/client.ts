import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://qutmwznbbypvpurqtmvx.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1dG13em5iYnlwdnB1cnF0bXZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYxNDIwNzcsImV4cCI6MjA3MTcxODA3N30.FjLOjG_0nr2Dzcd_gRkS56p6w8bILxiHCFcyW7-pTHk'

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

/**
 * Supabase 浏览器端客户端
 * 使用 anon 密钥，只有有限的数据库访问权限
 * 安全地暴露到浏览器端
 */
export const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true
  }
})

export default supabaseClient
