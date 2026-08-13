# TryToSeek 🔍

> 一个由真人驱动的聊天网站 —— 模仿 [ChatTJB](https://chattjb.org) 的概念

用户发送消息，管理员（真人）手动回复。界面模仿 ChatGPT 的简洁风格。支持文字、图片、视频、文件等多种消息格式。

---

## 🏗️ 技术架构

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│   用户端 (index) │◄──────►│  Supabase Backend │◄──────►│  管理员端 (admin) │
│  ChatGPT 风格 UI │  Realtime │  Auth + DB + Storage│  Realtime │   真人回复界面   │
└─────────────────┘         └──────────────────┘         └─────────────────┘
```

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端 | 原生 HTML/CSS/JS | 零依赖构建，CDN 引入 Supabase JS |
| 认证 | Supabase Auth | 邮箱注册/登录 |
| 数据库 | Supabase PostgreSQL | 对话 + 消息表 |
| 存储 | Supabase Storage | 图片/视频/文件附件 |
| 实时 | Supabase Realtime | 新消息推送 + 轮询兜底 |

---

## 📂 项目结构

```
trytoseek/
├── index.html          # 用户端聊天页面
├── admin.html          # 管理员端页面
├── login.html          # 登录/注册页面
├── css/
│   └── style.css       # 全局样式 (ChatGPT 暗色/亮色主题)
├── js/
│   ├── config.example.js  # 配置文件模板（复制为 config.js）
│   ├── supabase.js       # Supabase 客户端 + 工具函数
│   ├── auth.js           # 认证逻辑（登录/注册/登出）
│   ├── chat.js           # 用户端聊天核心逻辑
│   └── admin.js          # 管理员端逻辑
├── sql/
│   └── schema.sql        # 数据库建表 + RLS 策略
└── README.md
```

---

## 🚀 部署指南

### 第一步：创建 Supabase 项目

1. 访问 [supabase.com](https://supabase.com) 注册并创建新项目
2. 等待项目初始化完成（约 2 分钟）

### 第二步：执行数据库脚本

1. 打开 Supabase Dashboard → **SQL Editor**
2. 新建查询，复制粘贴 `sql/schema.sql` 的全部内容
3. 点击 **Run** 执行

脚本会自动创建：
- `profiles` 表（用户资料）
- `conversations` 表（对话）
- `messages` 表（消息）
- 所有 RLS 安全策略
- 自动触发器（更新时间戳、创建 profile）
- Realtime 发布配置

### 第三步：创建 Storage Bucket

1. 进入 **Storage** 页面
2. 点击 **Create bucket**
3. 名称：`message-attachments`
4. 设置为 **Private**（私有）
5. 点击创建

### 第四步：设置 Storage RLS 策略

在 SQL Editor 中执行以下策略：

```sql
-- 用户可上传自己对话的附件
CREATE POLICY "storage_upload_own" ON storage.objects
    FOR INSERT
    WITH CHECK (
        bucket_id = 'message-attachments'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

-- 用户可查看自己上传的附件
CREATE POLICY "storage_select_own" ON storage.objects
    FOR SELECT
    USING (
        bucket_id = 'message-attachments'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

-- 管理员可查看所有附件
CREATE POLICY "storage_select_admin" ON storage.objects
    FOR SELECT
    USING (
        bucket_id = 'message-attachments'
        AND EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );

-- 管理员可上传附件
CREATE POLICY "storage_insert_admin" ON storage.objects
    FOR INSERT
    WITH CHECK (
        bucket_id = 'message-attachments'
        AND EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );
```

### 第五步：创建管理员账号

1. 打开 `login.html` 注册一个账号
2. 在 Supabase Dashboard → **SQL Editor** 执行：

```sql
-- 将你的邮箱替换为实际注册邮箱
UPDATE public.profiles 
SET is_admin = TRUE 
WHERE email = 'your-email@example.com';
```

### 第六步：配置前端

1. 复制 `js/config.example.js` 为 `js/config.js`
2. 填入你的 Supabase 项目信息：

```javascript
const TRYTOSEEK_CONFIG = {
    SUPABASE_URL: 'https://xxxx.supabase.co',
    SUPABASE_ANON_KEY: 'eyJ...',
    STORAGE_BUCKET: 'message-attachments',
    // ...
};
```

获取方式：Supabase Dashboard → **Settings** → **API**

### 第七步：部署前端

选择任一静态托管服务：

| 服务 | 说明 |
|------|------|
| **Vercel** | 推荐，自动部署 Git 仓库 |
| **Netlify** | 拖拽部署，零配置 |
| **GitHub Pages** | 免费，适合个人项目 |
| **Cloudflare Pages** | 免费 + 全球 CDN |
| **自托管** | Nginx / Apache 静态服务 |

> ⚠️ 确保 `config.js` 不被提交到公开仓库（已在 `.gitignore` 中忽略）

---

## 🔒 RLS 安全策略说明

这是本项目的**核心安全层**，确保数据隔离：

### Conversations 表
| 策略 | 谁能做 | 条件 |
|------|--------|------|
| `select_own` | 用户 | 只能看自己的对话 |
| `select_admin` | 管理员 | 可看所有对话 |
| `insert_own` | 用户 | 只能创建自己的对话 |
| `insert_admin` | 管理员 | 可创建任意对话 |
| `update_own` | 用户 | 只能改自己的对话 |
| `update_admin` | 管理员 | 可改所有对话 |

### Messages 表
| 策略 | 谁能做 | 条件 |
|------|--------|------|
| `select_own` | 用户 | 只能看自己对话的消息 |
| `select_admin` | 管理员 | 可看所有消息 |
| `insert_user` | 用户 | 只能发 `sender_type='user'` 的消息到自己对话 |
| `insert_admin` | 管理员 | 只能发 `sender_type='admin'` 的消息 |
| `update_admin` | 管理员 | 可更新消息（标记已读等） |

### 关键安全规则
- **用户无法伪装成管理员发消息**（RLS 强制 `sender_type` 匹配身份）
- **用户无法读取其他用户的对话**
- **所有写操作都经过 RLS 验证**

---

## ⚡ 核心功能说明

### 1. 自动刷新 vs 打字保护

| 机制 | 说明 |
|------|------|
| **Realtime 订阅** | Supabase WebSocket 推送，毫秒级延迟 |
| **轮询兜底** | 每 8-10 秒检查一次（防止 WebSocket 断连） |
| **打字保护** | 用户正在输入时（`isTyping=true`），跳过轮询刷新，防止打字内容被覆盖 |
| **草稿保存** | 输入框内容实时存入 `localStorage`，刷新/重开页面不丢失 |

### 2. 消息格式支持

| 类型 | 说明 | 限制 |
|------|------|------|
| 文字 | 支持换行、URL 自动转链接 | 无限制 |
| 图片 | 上传到 Supabase Storage | 单文件 ≤ 25MB |
| 视频 | 支持 mp4/mov 等 | 单文件 ≤ 25MB |
| 文件 | 任意类型附件下载 | 单文件 ≤ 25MB |

### 3. 管理员功能

- 查看所有用户对话列表
- 按"未读"筛选
- 统计面板（用户数/对话数/消息数/未读数）
- 一键全部标为已读
- 支持文字 + 图片 + 文件回复
- 每个对话独立草稿保存

---

## 🎨 界面预览

### 用户端
- ChatGPT 风格侧边栏 + 主聊天区
- 暗色/亮色主题切换
- 消息气泡区分用户和管理员
- 附件以缩略图/文件卡片展示
- 图片点击放大预览
- 新消息 Toast 通知 + 提示音

### 管理员端
- 用户对话列表（显示未读数量）
- 一键切换用户对话
- 统计面板一目了然
- 回复体验与用户端一致

---

## 🔧 开发调试

### 本地运行

```bash
# 使用任意静态服务器
npx serve trytoseek/
# 或
python3 -m http.server 3000 -d trytoseek/
```

### 浏览器控制台调试

```javascript
// 查看当前用户
await Auth.getCurrentUser()

// 查看 Supabase 客户端
window.TryToSeek.supabase

// 手动查询对话
await window.TryToSeek.supabase.from('conversations').select('*')

// 检查 RLS 是否生效（用普通用户身份应看不到他人数据）
```

---

## 📝 注意事项

1. **Storage Bucket 必须设为 Private**，否则任何人都能访问附件
2. **Anon Key 是公开的**，安全完全依赖 RLS 策略
3. **管理员账号的 `is_admin` 字段必须在数据库手动设置**
4. **生产环境建议开启 Supabase 的 Row Level Security 审计日志**
5. **如需邮箱验证**，在 Supabase Auth 设置中开启 "Confirm email"

---

## 📄 License

MIT License - 自由使用、修改、分发
