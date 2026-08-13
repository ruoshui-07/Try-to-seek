-- ============================================
-- TryToSeek - Supabase Database Schema
-- ============================================

-- 启用必要的扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- 1. 创建自定义类型
-- ============================================
CREATE TYPE message_content_type AS ENUM ('text', 'image', 'video', 'file');
CREATE TYPE message_sender_type AS ENUM ('user', 'admin');
CREATE TYPE conversation_status AS ENUM ('active', 'closed');

-- ============================================
-- 2. 创建 profiles 表（扩展 Supabase Auth 用户信息）
-- ============================================
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    display_name TEXT,
    avatar_url TEXT,
    is_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 3. 创建 conversations 表
-- ============================================
CREATE TABLE IF NOT EXISTS public.conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT DEFAULT '新对话',
    status conversation_status DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 4. 创建 messages 表
-- ============================================
CREATE TABLE IF NOT EXISTS public.messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    sender_type message_sender_type NOT NULL,
    content_type message_content_type DEFAULT 'text',
    content TEXT,
    file_name TEXT,
    file_size BIGINT,
    file_mime_type TEXT,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 5. 创建 indexes 提升查询性能
-- ============================================
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON public.conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON public.conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON public.messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON public.messages(created_at);

-- ============================================
-- 6. 创建自动更新 updated_at 的触发器函数
-- ============================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 为 conversations 表添加触发器
CREATE TRIGGER update_conversations_updated_at
    BEFORE UPDATE ON public.conversations
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- 7. 创建新用户注册时自动创建 profile 的触发器
-- ============================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, display_name)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- 8. 设置 Storage Bucket
-- ============================================
-- 注意：Storage bucket 需要在 Supabase Dashboard 手动创建或通过 API 创建
-- 名称: 'message-attachments'
-- 设置为 private bucket

-- ============================================
-- 9. Row Level Security (RLS) 策略
-- ============================================

-- 启用 RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------
-- profiles 表的 RLS 策略
-- --------------------------------------------

-- 用户可查看自己的 profile
CREATE POLICY "profiles_select_own" ON public.profiles
    FOR SELECT
    USING (auth.uid() = id);

-- 管理员可查看所有 profiles
CREATE POLICY "profiles_select_admin" ON public.profiles
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.is_admin = TRUE
        )
    );

-- 用户可更新自己的 profile
CREATE POLICY "profiles_update_own" ON public.profiles
    FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- --------------------------------------------
-- conversations 表的 RLS 策略
-- --------------------------------------------

-- 用户可查看自己的对话
CREATE POLICY "conversations_select_own" ON public.conversations
    FOR SELECT
    USING (auth.uid() = user_id);

-- 管理员可查看所有对话
CREATE POLICY "conversations_select_admin" ON public.conversations
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.is_admin = TRUE
        )
    );

-- 用户可创建自己的对话
CREATE POLICY "conversations_insert_own" ON public.conversations
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- 管理员可创建对话（用于代表用户）
CREATE POLICY "conversations_insert_admin" ON public.conversations
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.is_admin = TRUE
        )
    );

-- 用户可更新自己的对话（如修改标题）
CREATE POLICY "conversations_update_own" ON public.conversations
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- 管理员可更新所有对话
CREATE POLICY "conversations_update_admin" ON public.conversations
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.is_admin = TRUE
        )
    );

-- 用户可删除自己的对话
CREATE POLICY "conversations_delete_own" ON public.conversations
    FOR DELETE
    USING (auth.uid() = user_id);

-- --------------------------------------------
-- messages 表的 RLS 策略
-- --------------------------------------------

-- 用户可查看自己对话中的消息
CREATE POLICY "messages_select_own" ON public.messages
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.conversations c
            WHERE c.id = messages.conversation_id
            AND c.user_id = auth.uid()
        )
    );

-- 管理员可查看所有消息
CREATE POLICY "messages_select_admin" ON public.messages
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.is_admin = TRUE
        )
    );

-- 用户可发送消息到自己的对话（sender_type 必须为 'user'）
CREATE POLICY "messages_insert_user" ON public.messages
    FOR INSERT
    WITH CHECK (
        auth.uid() = sender_id
        AND sender_type = 'user'
        AND EXISTS (
            SELECT 1 FROM public.conversations c
            WHERE c.id = conversation_id
            AND c.user_id = auth.uid()
        )
    );

-- 管理员可发送消息到任何对话（sender_type 必须为 'admin'）
CREATE POLICY "messages_insert_admin" ON public.messages
    FOR INSERT
    WITH CHECK (
        auth.uid() = sender_id
        AND sender_type = 'admin'
        AND EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.is_admin = TRUE
        )
    );

-- 管理员可更新消息（如标记已读）
CREATE POLICY "messages_update_admin" ON public.messages
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.is_admin = TRUE
        )
    );

-- 用户可将自己对话中的消息标记为已读
CREATE POLICY "messages_update_read_own" ON public.messages
    FOR UPDATE
    USING (
        sender_type = 'admin'
        AND EXISTS (
            SELECT 1 FROM public.conversations c
            WHERE c.id = messages.conversation_id
            AND c.user_id = auth.uid()
        )
    )
    WITH CHECK (
        is_read IS NOT NULL  -- 只允许更新 is_read 字段
    );

-- ============================================
-- 10. Storage RLS 策略 (message-attachments bucket)
-- ============================================

-- 注意：以下策略需要在 Supabase Dashboard 的 Storage 部分设置
-- 或通过 Supabase CLI 设置

-- 用户可上传自己对话的附件
-- INSERT policy:
--   bucket_id = 'message-attachments'
--   auth.uid() = (storage.foldername(name))[1]::uuid  (用户ID在路径中)

-- 用户可查看自己上传的附件
-- SELECT policy:
--   bucket_id = 'message-attachments'
--   auth.uid() = (storage.foldername(name))[1]::uuid

-- 管理员可查看所有附件
-- SELECT policy:
--   bucket_id = 'message-attachments'
--   EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)

-- ============================================
-- 11. 设置 Realtime 发布
-- ============================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;

-- ============================================
-- 12. 创建管理员用户（手动执行，替换为你的邮箱）
-- ============================================
-- 步骤：
-- 1. 先在网站上用管理员邮箱注册
-- 2. 然后执行以下 SQL 将用户设为管理员：
-- 
-- UPDATE public.profiles 
-- SET is_admin = TRUE 
-- WHERE email = 'your-admin-email@example.com';
--
-- 或者直接指定用户ID：
-- UPDATE public.profiles 
-- SET is_admin = TRUE 
-- WHERE id = 'your-user-uuid-here';

-- ============================================
-- 完成！
-- ============================================
-- 后续步骤：
-- 1. 在 Supabase Dashboard 创建 Storage bucket: 'message-attachments' (private)
-- 2. 注册第一个用户，然后将其设为管理员
-- 3. 配置 Storage RLS 策略
-- 4. 部署前端文件到你的托管服务
