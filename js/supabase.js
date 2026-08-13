/**
 * TryToSeek - Supabase 初始化配置
 * 
 * 使用方式（二选一）：
 * 
 * 方式1：使用 config.js（推荐）
 *   1. 复制 config.example.js 为 config.js
 *   2. 填入你的 Supabase 项目信息
 *   3. 在 HTML 中加载 config.js（在 supabase.js 之前）
 * 
 * 方式2：直接修改下方常量
 */

// 优先使用 config.js 中的配置
const SUPABASE_URL = (typeof TRYTOSEEK_CONFIG !== 'undefined') 
    ? TRYTOSEEK_CONFIG.SUPABASE_URL 
    : 'YOUR_SUPABASE_URL_HERE';

const SUPABASE_ANON_KEY = (typeof TRYTOSEEK_CONFIG !== 'undefined')
    ? TRYTOSEEK_CONFIG.SUPABASE_ANON_KEY
    : 'YOUR_SUPABASE_ANON_KEY_HERE';

// 创建 Supabase 客户端（不再声明全局 supabase）
const _supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: window.localStorage
    },
    realtime: {
        params: {
            eventsPerSecond: 10
        }
    }
});

// Storage bucket 名称
const STORAGE_BUCKET = (typeof TRYTOSEEK_CONFIG !== 'undefined')
    ? TRYTOSEEK_CONFIG.STORAGE_BUCKET
    : 'message-attachments';

// ============================================================
// 文件上传安全配置
// ============================================================

// 最大文件大小：50MB（字节）
const MAX_FILE_SIZE = 50 * 1024 * 1024;

// 允许的 MIME 类型（与 Supabase Storage 后台设置保持一致）
const ALLOWED_MIME_TYPES = [
    // 图片
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    // 视频
    'video/mp4',
    'video/mpeg',
    'video/webm',
    'video/quicktime',
    // 音频
    'audio/mpeg',
    'audio/wav',
    'audio/ogg',
    'audio/webm',
    // 文档
    'application/pdf',
    'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    // 压缩包
    'application/zip',
    'application/x-rar-compressed'
];

// 人类可读的大小限制提示
const MAX_FILE_SIZE_READABLE = '50MB';

// ============================================================
// 文件上传函数（带双重校验）
// ============================================================

/**
 * 校验文件是否合法（大小 + MIME 类型）
 * @param {File} file - 要校验的文件
 * @returns { { valid: boolean, error?: string } }
 */
function validateFile(file) {
    // 1. 检查文件大小
    if (file.size > MAX_FILE_SIZE) {
        return {
            valid: false,
            error: `文件 "${file.name}" 过大（${formatFileSize(file.size)}），最大支持 ${MAX_FILE_SIZE_READABLE}`
        };
    }

    // 2. 检查 MIME 类型
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
        return {
            valid: false,   // 修复：去掉多余的 "boolean = "
            error: `文件 "${file.name}" 类型不支持（${file.type || '未知类型'}），仅允许图片、视频、音频、PDF 和文档`
        };
    }

    return { valid: true };
}

/**
 * 上传文件到 Supabase Storage（带前端校验）
 * @param {string} path - 存储路径，如 "user-id/uuid-filename.jpg"
 * @param {File} file - 文件对象
 * @returns {Promise<{ url: string, path: string }>}
 */
async function uploadFile(path, file) {
    // 1. 前端校验
    const validation = validateFile(file);
    if (!validation.valid) {
        throw new Error(validation.error);
    }

    // 2. 上传到 Supabase Storage
    //    同时传递 size 参数作为第二道防线（Supabase 会拒绝超过此大小的文件）
    const { data, error } = await _supabaseClient.storage   // 注意这里也要改
        .from(STORAGE_BUCKET)
        .upload(path, file, {
            cacheControl: '3600',
            upsert: false,
            contentType: file.type,
            size: MAX_FILE_SIZE  // 服务端也会校验
        });

    if (error) {
        // 处理 Supabase 返回的具体错误
        if (error.message.includes('size')) {
            throw new Error(`文件超过大小限制（最大 ${MAX_FILE_SIZE_READABLE}）`);
        }
        throw new Error(`上传失败：${error.message}`);
    }

    // 3. 获取公开 URL
    const { data: urlData } = _supabaseClient.storage   // 注意这里也要改
        .from(STORAGE_BUCKET)
        .getPublicUrl(data.path);

    return {
        url: urlData.publicUrl,
        path: data.path
    };
}

/**
 * 删除已上传的文件（用于上传失败回滚或用户主动删除）
 * @param {string} path - 文件路径
 */
async function deleteFile(path) {
    const { error } = await _supabaseClient.storage   // 注意这里也要改
        .from(STORAGE_BUCKET)
        .remove([path]);
    
    if (error) {
        console.warn('删除文件失败:', error.message);
    }
}

/**
 * 从文件路径提取文件名
 * @param {string} path - 完整路径或 URL
 * @returns {string} 文件名
 */
function getFileNameFromPath(path) {
    if (!path) return '';
    const parts = path.split('/');
    return parts[parts.length - 1];
}

/**
 * 判断文件是否为图片
 * @param {string} mimeType - MIME 类型
 * @returns {boolean}
 */
function isImage(mimeType) {
    return mimeType?.startsWith('image/') || false;
}

/**
 * 判断文件是否为视频
 * @param {string} mimeType - MIME 类型
 * @returns {boolean}
 */
function isVideo(mimeType) {
    return mimeType?.startsWith('video/') || false;
}

// ============================================================
// 工具函数：检查当前用户是否为管理员
// ============================================================
async function isAdmin() {
    const { data: { user } } = await _supabaseClient.auth.getUser();   // 注意这里也要改
    if (!user) return false;
    
    const { data: profile } = await _supabaseClient   // 注意这里也要改
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .single();
    
    return profile?.is_admin || false;
}

// ============================================================
// 工具函数：获取当前用户信息
// ============================================================
async function getCurrentUser() {
    const { data: { user } } = await _supabaseClient.auth.getUser();   // 注意这里也要改
    if (!user) return null;
    
    const { data: profile } = await _supabaseClient   // 注意这里也要改
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
    
    return { ...user, profile };
}

// ============================================================
// 工具函数：格式化时间（相对时间）
// ============================================================
function formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return '刚刚';
    if (diffMins < 60) return `${diffMins}分钟前`;
    if (diffHours < 24) return `${diffHours}小时前`;
    if (diffDays < 7) return `${diffDays}天前`;
    
    return date.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// ============================================================
// 工具函数：格式化文件大小
// ============================================================
function formatFileSize(bytes) {
    if (!bytes) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}

// ============================================================
// 工具函数：生成对话标题
// ============================================================
function generateTitle(content) {
    if (!content) return '新对话';
    const text = content.replace(/<[^>]*>/g, '').trim();
    return text.length > 20 ? text.substring(0, 20) + '...' : text;
}

// ============================================================
// 导出到全局
// ============================================================
window.TryToSeek = {
    supabase: _supabaseClient,   // 这里用 _supabaseClient 赋值
    isAdmin,
    getCurrentUser,
    formatTime,
    formatFileSize,
    generateTitle,
    uploadFile,
    deleteFile,
    validateFile,
    isImage,
    isVideo,
    getFileNameFromPath,
    // 常量也暴露出去方便调试
    MAX_FILE_SIZE,
    MAX_FILE_SIZE_READABLE,
    ALLOWED_MIME_TYPES,
    STORAGE_BUCKET
};
