/**
 * TryToSeek - 配置文件模板
 * 
 * 使用方法：
 * 1. 复制此文件为 config.js
 * 2. 填入你的 Supabase 项目信息
 * 3. 在 supabase.js 中引入此配置
 * 
 * 获取方式：
 * Supabase Dashboard → Settings → API
 */

const TRYTOSEEK_CONFIG = {
    // Supabase 项目 URL
    SUPABASE_URL: 'https://bxkeqfsewhotnbcnfhme.supabase.co',
    
    // Supabase Anon (public) Key
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ4a2VxZnNld2hvdG5iY25maG1lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2MTI2MzAsImV4cCI6MjEwMjE4ODYzMH0.8yEsZ0ltoLHoXkhmDdLDHaX7G6D1DoqzLRXyMaVv6Ig',
    
    // Storage bucket 名称
    STORAGE_BUCKET: 'message-attachments',
    
    // 应用配置
    APP: {
        NAME: 'TryToSeek',
        TAGLINE: 'AI*=Average Individual',
        
        // 轮询间隔（毫秒）
        POLL_INTERVAL: 8000,
        
        // 文件上传限制（字节）
        MAX_FILE_SIZE: 50 * 1024 * 1024,  // 50MB
        
        // 自动刷新间隔
        AUTO_REFRESH: true,
    },
    
    // 管理员配置
    ADMIN: {
        // 管理员邮箱列表（也可以在数据库中设置 is_admin = true）
        EMAILS: [
            // 'admin@example.com'
        ],
    }
};

// 开发模式
const DEV_MODE = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
