/**
 * TryToSeek - 用户端聊天逻辑
 * 
 * 核心功能：
 * 1. 邮箱登录后自动加载对话列表
 * 2. 发送文字/图片/视频/文件消息
 * 3. 自动轮询 + Realtime 监听新回复
 * 4. 打字时不被刷新打断（草稿本地保存）
 * 5. 新消息到达时自动滚动
 */

(function () {
    'use strict';

    // ---------- 状态管理 ----------
    const State = {
        currentUser: null,
        currentConversationId: null,
        conversations: [],
        messages: [],
        isAdmin: false,
        isTyping: false,        // 用户是否正在输入
        draftContent: '',       // 输入框草稿
        pendingFiles: [],       // 待发送的文件
        isLoading: false,
        lastMessageCount: 0,   // 上次消息数量（用于检测新消息）
        pollInterval: null,     // 轮询定时器
        pollIntervalMs: 8000,  // 每8秒检查一次新回复
        realtimeChannel: null,  // Supabase Realtime 频道
    };

    // ---------- DOM 元素缓存 ----------
    const DOM = {
        sidebar: document.getElementById('sidebar'),
        sidebarToggle: document.getElementById('sidebarToggle'),
        conversationList: document.getElementById('conversationList'),
        currentConvTitle: document.getElementById('currentConvTitle'),
        chatContainer: document.getElementById('chatContainer'),
        welcomeScreen: document.getElementById('welcomeScreen'),
        messagesList: document.getElementById('messagesList'),
        messageInput: document.getElementById('messageInput'),
        sendBtn: document.getElementById('sendBtn'),
        newChatBtn: document.getElementById('newChatBtn'),
        statusBanner: document.getElementById('statusBanner'),
        statusText: document.getElementById('statusText'),
        typingIndicator: document.getElementById('typingIndicator'),
        typingText: document.getElementById('typingText'),
        uploadPreview: document.getElementById('uploadPreview'),
        uploadImageBtn: document.getElementById('uploadImageBtn'),
        uploadFileBtn: document.getElementById('uploadFileBtn'),
        imageInput: document.getElementById('imageInput'),
        fileInput: document.getElementById('fileInput'),
        refreshBtn: document.getElementById('refreshBtn'),
        userAvatar: document.getElementById('userAvatar'),
        userName: document.getElementById('userName'),
        userEmail: document.getElementById('userEmail'),
        userInfoBtn: document.getElementById('userInfoBtn'),
        userDropdown: document.getElementById('userDropdown'),
        logoutBtn: document.getElementById('logoutBtn'),
        themeToggle: document.getElementById('themeToggle'),
        themeLabel: document.getElementById('themeLabel'),
        goToAdmin: document.getElementById('goToAdmin'),
        adminDivider: document.getElementById('adminDivider'),
        mediaModal: document.getElementById('mediaModal'),
        modalClose: document.getElementById('modalClose'),
        modalContent: document.getElementById('modalContent'),
        toastContainer: document.getElementById('toastContainer'),
    };

    // ============================================
    // 【新增】安全垫：防止 clearUploadPreview 未定义
    // ============================================
    function clearUploadPreview() {
        // 这是一个空函数，确保任何地方调用都不会报错
        // 实际的清理逻辑由 renderUploadPreview 基于 State.pendingFiles 长度自动处理
    }

    // ============================================
    // 初始化
    // ============================================
    async function init() {
        // 等待认证就绪
        await waitForAuth();

        if (!Auth.isAuthenticated()) {
            window.location.href = 'login.html';
            return;
        }

        State.currentUser = Auth.getCurrentUser();
        State.isAdmin = await window.TryToSeek.isAdmin();

        // 初始化UI
        initUI();
        initEventListeners();

        // 加载对话列表
        await loadConversations();

        // 如果有对话，自动打开第一个
        if (State.conversations.length > 0) {
            openConversation(State.conversations[0].id);
        } else {
            // 没有对话时创建新对话
            await createNewConversation();
        }

        // 启动实时监听
        startRealtimeSubscription();

        // 启动轮询（兜底方案）
        startPolling();

        // 检查 URL 参数（如 from=admin 等）
        checkUrlParams();
    }

    function waitForAuth() {
        return new Promise((resolve) => {
            if (Auth.getCurrentUser()) return resolve();
            window.addEventListener('auth:ready', () => resolve(), { once: true });
            // 超时保护
            setTimeout(resolve, 3000);
        });
    }

    // ============================================
    // UI 初始化
    // ============================================
    function initUI() {
        const user = State.currentUser;
        const email = user.email || '';
        const displayName = user.user_metadata?.display_name || email.split('@')[0] || '用户';

        DOM.userName.textContent = displayName;
        DOM.userEmail.textContent = email;
        DOM.userAvatar.textContent = displayName.charAt(0).toUpperCase();

        // 如果有头像URL
        if (user.user_metadata?.avatar_url) {
            DOM.userAvatar.innerHTML = `<img src="${user.user_metadata.avatar_url}" alt="avatar">`;
        }

        // 管理员入口
        if (State.isAdmin) {
            DOM.goToAdmin.style.display = 'flex';
            DOM.adminDivider.style.display = 'block';
        }

        // 主题
        const savedTheme = localStorage.getItem('trytoseek_theme') || 'dark';
        setTheme(savedTheme);

        // 恢复草稿
        const savedDraft = localStorage.getItem('trytoseek_draft');
        if (savedDraft) {
            DOM.messageInput.value = savedDraft;
            autoResizeTextarea();
        }
    }

    function initEventListeners() {
        // 侧边栏切换（移动端）
        DOM.sidebarToggle.addEventListener('click', () => {
            DOM.sidebar.classList.toggle('open');
        });

        // 新建对话
        DOM.newChatBtn.addEventListener('click', () => {
            createNewConversation();
        });

        // 发送消息
        DOM.sendBtn.addEventListener('click', sendMessage);

        // 输入框事件
        DOM.messageInput.addEventListener('input', handleInputChange);
        DOM.messageInput.addEventListener('keydown', handleKeyDown);
        DOM.messageInput.addEventListener('focus', () => { State.isTyping = true; });
        DOM.messageInput.addEventListener('blur', () => { State.isTyping = false; });

        // 文件上传
        DOM.uploadImageBtn.addEventListener('click', () => DOM.imageInput.click());
        DOM.uploadFileBtn.addEventListener('click', () => DOM.fileInput.click());
        DOM.imageInput.addEventListener('change', (e) => handleFileSelect(e.target.files, 'image'));
        DOM.fileInput.addEventListener('change', (e) => handleFileSelect(e.target.files, 'file'));

        // 刷新按钮
        DOM.refreshBtn.addEventListener('click', () => {
            if (State.currentConversationId) {
                loadMessages(State.currentConversationId, true);
                showToast('已刷新', 'info');
            }
        });

        // 用户菜单
        DOM.userInfoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            DOM.userDropdown.classList.toggle('active');
        });

        document.addEventListener('click', () => {
            DOM.userDropdown.classList.remove('active');
        });

        // 退出登录
        DOM.logoutBtn.addEventListener('click', async () => {
            await Auth.signOut();
            window.location.href = 'login.html';
        });

        // 主题切换
        DOM.themeToggle.addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-theme') || 'dark';
            const next = current === 'dark' ? 'light' : 'dark';
            setTheme(next);
        });

        // 管理员入口
        DOM.goToAdmin.addEventListener('click', () => {
            window.location.href = 'admin.html';
        });

        // 模态框关闭
        DOM.modalClose.addEventListener('click', closeMediaModal);
        DOM.mediaModal.addEventListener('click', (e) => {
            if (e.target === DOM.mediaModal) closeMediaModal();
        });

        // 键盘快捷键
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeMediaModal();
                DOM.userDropdown.classList.remove('active');
            }
        });

        // 页面可见性变化（切回页面时刷新）
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && State.currentConversationId) {
                loadMessages(State.currentConversationId, true);
            }
        });

        // 防止意外关闭时保存草稿
        window.addEventListener('beforeunload', () => {
            saveDraft();
        });
    }

    // ============================================
    // 主题管理
    // ============================================
    function setTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('trytoseek_theme', theme);
        DOM.themeLabel.textContent = theme === 'dark' ? '切换亮色模式' : '切换暗色模式';
    }

    // ============================================
    // 对话管理
    // ============================================
    async function loadConversations() {
        try {
            const { data, error } = await window.TryToSeek.supabase
                .from('conversations')
                .select(`
                    *,
                    messages:messages(count),
                    last_message:messages(
                        content, content_type, created_at, sender_type
                    )
                `)
                .order('updated_at', { ascending: false });

            if (error) throw error;

            State.conversations = data || [];
            renderConversationList();
        } catch (error) {
            console.error('加载对话失败:', error);
            showToast('加载对话失败: ' + error.message, 'error');
        }
    }

    function renderConversationList() {
        if (State.conversations.length === 0) {
            DOM.conversationList.innerHTML = `
                <div class="empty-state" style="padding:20px;font-size:12px;">
                    <div class="empty-state-icon">💭</div>
                    暂无对话<br>点击上方按钮开始
                </div>
            `;
            return;
        }

        DOM.conversationList.innerHTML = State.conversations.map(conv => {
            const lastMsg = conv.last_message?.[0];
            const preview = lastMsg 
                ? (lastMsg.content_type === 'text' 
                    ? lastMsg.content?.substring(0, 30) 
                    : `[${getContentTypeLabel(lastMsg.content_type)}]`)
                : '暂无消息';
            
            const time = lastMsg ? window.TryToSeek.formatTime(lastMsg.created_at) : '';
            const isActive = conv.id === State.currentConversationId;

            return `
                <div class="conversation-item ${isActive ? 'active' : ''}" 
                     data-id="${conv.id}"
                     onclick="ChatApp.openConversation('${conv.id}')">
                    <svg class="conv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    <span class="conv-title">${escapeHtml(conv.title || '新对话')}</span>
                    ${time ? `<span style="margin-left:auto;font-size:11px;color:var(--text-muted);white-space:nowrap;">${time}</span>` : ''}
                </div>
            `;
        }).join('');
    }

    async function createNewConversation() {
        try {
            const { data, error } = await window.TryToSeek.supabase
                .from('conversations')
                .insert({
                    user_id: State.currentUser.id,
                    title: '新对话',
                    status: 'active'
                })
                .select()
                .single();

            if (error) throw error;

            State.conversations.unshift(data);
            renderConversationList();
            openConversation(data.id);
            showToast('新对话已创建', 'success');
        } catch (error) {
            console.error('创建对话失败:', error);
            showToast('创建对话失败: ' + error.message, 'error');
        }
    }

    async function openConversation(conversationId) {
        State.currentConversationId = conversationId;
        const conv = State.conversations.find(c => c.id === conversationId);
        
        if (conv) {
            DOM.currentConvTitle.textContent = conv.title || '新对话';
        }

        // 更新侧边栏激活状态
        document.querySelectorAll('.conversation-item').forEach(el => {
            el.classList.toggle('active', el.dataset.id === conversationId);
        });

        // 隐藏欢迎屏幕，显示消息列表
        DOM.welcomeScreen.style.display = 'none';
        DOM.messagesList.style.display = 'block';
        DOM.messageInput.disabled = false;
        DOM.sendBtn.disabled = false;

        // 加载消息
        await loadMessages(conversationId);

        // 滚动到底部
        scrollToBottom();
    }

    // ============================================
    // 消息管理
    // ============================================
    async function loadMessages(conversationId, isRefresh = false) {
    if (State.isLoading) return;
    State.isLoading = true;

    // ✨ 开始加载：将消息列表变淡（直接设置样式，不依赖CSS）
    DOM.messagesList.style.opacity = '1';
    DOM.messagesList.style.transition = 'opacity 0.2s ease'; // 加个过渡更平滑

    try {
        const { data, error } = await window.TryToSeek.supabase
            .from('messages')
            .select('*')
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: true });

        if (error) throw error;

        const oldCount = State.messages.length;
        State.messages = data || [];

        // 检测新消息（管理员回复）
        if (isRefresh && oldCount > 0 && State.messages.length > oldCount) {
            const newMsgs = State.messages.slice(oldCount);
            const hasAdminReply = newMsgs.some(m => m.sender_type === 'admin');
            if (hasAdminReply && !State.isTyping) {
                showToast('收到新回复！', 'success');
                playNotificationSound();
            }
        }

        State.lastMessageCount = State.messages.length;
        renderMessages();

        // 标记管理员消息为已读
        markMessagesAsRead(conversationId);

    } catch (error) {
        console.error('加载消息失败:', error);
        if (!isRefresh) showToast('加载消息失败: ' + error.message, 'error');
    } finally {
        State.isLoading = false;
        // ✨ 加载完成：恢复完全不透明
        DOM.messagesList.style.opacity = '1';
    }
}

    function renderMessages() {
        if (State.messages.length === 0) {
            DOM.messagesList.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">👋</div>
                    发送第一条消息开始对话<br>
                    <small style="margin-top:8px;display:block;color:var(--text-muted);">
                        管理员会亲自回复你
                    </small>
                </div>
            `;
            return;
        }

        // 按日期分组
        const groups = groupMessagesByDate(State.messages);

        DOM.messagesList.innerHTML = groups.map(group => `
            <div class="message-group">
                <div class="message-date-divider">
                    <span>${group.dateLabel}</span>
                </div>
                ${group.messages.map(msg => renderMessage(msg)).join('')}
            </div>
        `).join('');

        // 绑定附件点击事件
        bindAttachmentEvents();

        // 如果不是正在输入，滚动到底部
        if (!State.isTyping) {
            scrollToBottom();
        }
    }

    function renderMessage(msg) {
        const isUser = msg.sender_type === 'user';
        const time = window.TryToSeek.formatTime(msg.created_at);
        const senderName = isUser ? '我' : '管理员';
        const avatarText = isUser 
            ? (State.currentUser.email?.charAt(0).toUpperCase() || '我')
            : 'A';

        let contentHtml = '';

        if (msg.content_type === 'text') {
            contentHtml = `<div class="message-bubble">${formatMessageText(msg.content)}</div>`;
        } else if (msg.content_type === 'image') {
            contentHtml = `
                <div class="message-bubble">
                    ${msg.content ? `<p>${escapeHtml(msg.content)}</p>` : ''}
                    <div class="message-attachments">
                        <img src="${msg.content}" alt="${escapeHtml(msg.file_name || 'image')}" 
                             class="attachment-image" data-src="${msg.content}" 
                             data-type="image" loading="lazy">
                    </div>
                </div>
            `;
        } else if (msg.content_type === 'video') {
            contentHtml = `
                <div class="message-bubble">
                    ${msg.content ? `<p>${escapeHtml(msg.content)}</p>` : ''}
                    <div class="message-attachments">
                        <video src="${msg.content}" controls preload="metadata" 
                               style="max-width:300px;border-radius:8px;"></video>
                    </div>
                </div>
            `;
        } else if (msg.content_type === 'file') {
            const fileIcon = getFileIcon(msg.file_name);
            contentHtml = `
                <div class="message-bubble">
                    <a href="${msg.content}" target="_blank" rel="noopener" class="attachment-file">
                        <span class="attachment-file-icon">${fileIcon}</span>
                        <div class="attachment-file-info">
                            <div class="attachment-file-name">${escapeHtml(msg.file_name || '未知文件')}</div>
                            <div class="attachment-file-size">${window.TryToSeek.formatFileSize(msg.file_size || 0)}</div>
                        </div>
                    </a>
                </div>
            `;
        }

        return `
            <div class="message ${isUser ? 'user' : 'admin'}" data-id="${msg.id}">
                <div class="message-avatar">${avatarText}</div>
                <div class="message-content">
                    <div class="message-header">
                        <span class="message-sender">${senderName}</span>
                        <span class="message-time">${time}</span>
                        ${msg.is_read ? '<span style="font-size:10px;color:var(--accent);">✓ 已读</span>' : ''}
                    </div>
                    ${contentHtml}
                </div>
            </div>
        `;
    }

    function groupMessagesByDate(messages) {
        const groups = [];
        let currentGroup = null;

        messages.forEach(msg => {
            const date = new Date(msg.created_at);
            const dateStr = date.toDateString();

            if (!currentGroup || currentGroup.dateStr !== dateStr) {
                currentGroup = {
                    dateStr,
                    dateLabel: formatDateLabel(date),
                    messages: []
                };
                groups.push(currentGroup);
            }

            currentGroup.messages.push(msg);
        });

        return groups;
    }

    function formatDateLabel(date) {
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        if (date.toDateString() === today.toDateString()) return '今天';
        if (date.toDateString() === yesterday.toDateString()) return '昨天';

        return date.toLocaleDateString('zh-CN', { 
            year: 'numeric', month: 'long', day: 'numeric' 
        });
    }

    // ============================================
    // 发送消息
    // ============================================
   async function sendMessage() {
    // 注意：clearUploadPreview 已在 IIFE 顶部定义为空函数，无需再次定义
    // 确保没有调用 clearUploadPreview()

    const text = DOM.messageInput.value.trim();
    const hasFiles = State.pendingFiles.length > 0;

    if (!text && !hasFiles) return;
    if (!State.currentConversationId) {
        await createNewConversation();
    }

    // 复制待发送文件列表并清空
    const filesToSend = [...State.pendingFiles];
    State.pendingFiles = []; // 这会触发 renderUploadPreview 清空预览

    // 清空输入框
    DOM.messageInput.value = '';
    autoResizeTextarea();
    saveDraft();

    try {
        // 如果有文字，先发送文字消息
        if (text) {
            await insertMessage({
                conversation_id: State.currentConversationId,
                sender_type: 'user',
                sender_id: State.currentUser.id,  // 🔥 关键修复：加上 sender_id
                content_type: 'text',
                content: text
            });

            // 更新对话标题（如果是第一条消息）
            const conv = State.conversations.find(c => c.id === State.currentConversationId);
            if (conv && conv.title === '新对话') {
                const title = window.TryToSeek.generateTitle(text);
                await updateConversationTitle(State.currentConversationId, title);
            }
        }

        // 发送文件
        for (const fileData of filesToSend) {
            const { file, url } = fileData;
            const contentType = file.type.startsWith('image/') ? 'image' 
                               : file.type.startsWith('video/') ? 'video' 
                               : 'file';

            await insertMessage({
                conversation_id: State.currentConversationId,
                sender_type: 'user',
                sender_id: State.currentUser.id,  // 🔥 关键修复：加上 sender_id
                content_type: contentType,
                content: url,
                file_name: file.name,
                file_size: file.size,
                file_mime_type: file.type
            });
        }

        // 重新加载消息
        await loadMessages(State.currentConversationId);
        
        // 更新对话列表
        await loadConversations();

        // 显示等待提示
        showStatusBanner('info', '✉️ 消息已发送，管理员会在看到后回复你');
        setTimeout(hideStatusBanner, 5000);

    } catch (error) {
        console.error('发送失败:', error);
        showToast('发送失败: ' + error.message, 'error');
    }
}
    
    async function insertMessage(msgData) {
        // 🔥 关键修改 1：打印出我们要发送的数据，方便对照数据库表结构
        console.log('准备发送到 Supabase 的数据:', msgData);

        const { error } = await window.TryToSeek.supabase
            .from('messages') // 🔥 关键修改 2：确保这里是复数 'messages'，与你的数据库表名一致
            .insert(msgData);

        // 🔥 关键修改 3：如果有错误，打印出详细的错误信息（这是解决 400 错误的关键！）
        if (error) {
            console.error('❌ Supabase 插入失败详情:', error);
            throw error;
        }
    }

    async function updateConversationTitle(conversationId, title) {
        try {
            await window.TryToSeek.supabase
                .from('conversations')
                .update({ title })
                .eq('id', conversationId);

            const conv = State.conversations.find(c => c.id === conversationId);
            if (conv) conv.title = title;
            DOM.currentConvTitle.textContent = title;
        } catch (e) {
            console.warn('更新标题失败:', e);
        }
    }

    // ============================================
    // 文件上传
    // ============================================
    async function handleFileSelect(files, type) {
        for (const file of files) {
            // 检查文件大小（限制 25MB）
            if (file.size > 25 * 1024 * 1024) {
                showToast(`文件 "${file.name}" 超过 25MB 限制`, 'error');
                continue;
            }

            // 上传到 Supabase Storage
            try {
                showToast(`正在上传 ${file.name}...`, 'info');

                const fileExt = file.name.split('.').pop();
                const fileName = `${State.currentUser.id}/${Date.now()}-${Math.random().toString(36).substr(2, 9)}.${fileExt}`;

                const { data, error } = await window.TryToSeek.supabase.storage
                    .from(window.TryToSeek.STORAGE_BUCKET)
                    .upload(fileName, file, {
                        cacheControl: '3600',
                        upsert: false
                    });

                if (error) throw error;

                // 获取公共URL（如果bucket是public）或签名URL
                const { data: urlData } = window.TryToSeek.supabase.storage
                    .from(window.TryToSeek.STORAGE_BUCKET)
                    .getPublicUrl(fileName);

                const fileUrl = urlData.publicUrl;

                State.pendingFiles.push({ file, url: fileUrl });

                showToast(`✓ ${file.name} 已准备好发送`, 'success');
            } catch (error) {
                console.error('上传失败:', error);
                showToast(`上传失败: ${error.message}`, 'error');
            }
        }

        renderUploadPreview();
        // 重置 input
        DOM.imageInput.value = '';
        DOM.fileInput.value = '';
    }

    function renderUploadPreview() {
        if (State.pendingFiles.length === 0) {
            DOM.uploadPreview.classList.remove('active');
            DOM.uploadPreview.innerHTML = '';
            return;
        }

        DOM.uploadPreview.classList.add('active');
        DOM.uploadPreview.innerHTML = State.pendingFiles.map((item, index) => {
            const isImage = item.file.type.startsWith('image/');
            const preview = isImage 
                ? `<img src="${URL.createObjectURL(item.file)}" alt="preview">`
                : `<span style="font-size:20px;">${getFileIcon(item.file.name)}</span>`;

            return `
                <div class="upload-preview-item">
                    ${preview}
                    <span class="upload-preview-name">${escapeHtml(item.file.name)}</span>
                    <button class="upload-preview-remove" onclick="ChatApp.removePendingFile(${index})">&times;</button>
                </div>
            `;
        }).join('');
    }

    // ============================================
    // 自动轮询 + Realtime
    // ============================================
    function startPolling() {
        stopPolling();
        State.pollInterval = setInterval(async () => {
            // 如果正在输入，跳过这次轮询（不覆盖用户正在打的字）
            if (State.isTyping) {
                console.log('[Polling] 用户正在输入，跳过');
                return;
            }

            if (State.currentConversationId && document.visibilityState === 'visible') {
                await loadMessages(State.currentConversationId, true);
            }
        }, State.pollIntervalMs);
    }

    function stopPolling() {
        if (State.pollInterval) {
            clearInterval(State.pollInterval);
            State.pollInterval = null;
        }
    }

    function startRealtimeSubscription() {
        if (State.realtimeChannel) {
            State.realtimeChannel.unsubscribe();
        }

        State.realtimeChannel = window.TryToSeek.supabase
            .channel('messages-changes')
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'messages',
                    filter: `conversation_id=eq.${State.currentConversationId || ''}`
                },
                (payload) => {
                    console.log('[Realtime] 新消息:', payload);
                    // 如果是管理员回复当前对话
                    if (payload.new.conversation_id === State.currentConversationId) {
                        // 直接添加到列表，不重新加载（避免闪烁）
                        const exists = State.messages.some(m => m.id === payload.new.id);
                        if (!exists) {
                            State.messages.push(payload.new);
                            renderMessages();
                            if (payload.new.sender_type === 'admin') {
                                showToast('📬 管理员回复了你！', 'success');
                                playNotificationSound();
                            }
                        }
                    }
                    // 刷新对话列表
                    loadConversations();
                }
            )
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'messages'
                },
                (payload) => {
                    console.log('[Realtime] 消息更新:', payload);
                    // 刷新消息列表以反映更新
                    if (State.currentConversationId) {
                        loadMessages(State.currentConversationId, true);
                    }
                }
            )
            .subscribe();
    }

    // ============================================
    // 标记消息已读
    // ============================================
    async function markMessagesAsRead(conversationId) {
        try {
            const unreadMsgs = State.messages.filter(
                m => m.sender_type === 'admin' && !m.is_read
            );

            for (const msg of unreadMsgs) {
                await window.TryToSeek.supabase
                    .from('messages')
                    .update({ is_read: true })
                    .eq('id', msg.id);
                
                msg.is_read = true;
            }
        } catch (error) {
            console.warn('标记已读失败:', error);
        }
    }

    // ============================================
    // 输入处理（草稿保存 + 自适应高度）
    // ============================================
    function handleInputChange() {
        autoResizeTextarea();
        saveDraft();
        State.isTyping = true;

        // 防抖：停止输入2秒后标记为非输入状态
        clearTimeout(State.typingTimeout);
        State.typingTimeout = setTimeout(() => {
            State.isTyping = false;
        }, 2000);
    }

    function handleKeyDown(e) {
        // Enter 发送（Shift+Enter 换行）
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    }

    function autoResizeTextarea() {
        DOM.messageInput.style.height = 'auto';
        DOM.messageInput.style.height = Math.min(DOM.messageInput.scrollHeight, 200) + 'px';
    }

    function saveDraft() {
        const draft = DOM.messageInput.value;
        State.draftContent = draft;
        localStorage.setItem('trytoseek_draft', draft);
    }

    // ============================================
    // 状态横幅
    // ============================================
    function showStatusBanner(type, text) {
        DOM.statusBanner.className = `status-banner ${type} active`;
        DOM.statusText.textContent = text;
    }

    function hideStatusBanner() {
        DOM.statusBanner.classList.remove('active');
    }

    // ============================================
    // Toast 通知
    // ============================================
    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        DOM.toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(40px)';
            toast.style.transition = 'all 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // ============================================
    // 媒体模态框
    // ============================================
    function bindAttachmentEvents() {
        document.querySelectorAll('.attachment-image').forEach(img => {
            img.addEventListener('click', () => {
                openMediaModal(img.dataset.src, 'image');
            });
        });
    }

    function openMediaModal(src, type) {
        DOM.modalContent.innerHTML = type === 'image' 
            ? `<img src="${src}" alt="preview">`
            : `<video src="${src}" controls autoplay></video>`;
        DOM.mediaModal.classList.add('active');
    }

    function closeMediaModal() {
        DOM.mediaModal.classList.remove('active');
        DOM.modalContent.innerHTML = '';
    }

    // ============================================
    // 通知声音
    // ============================================
    function playNotificationSound() {
        try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);

            oscillator.frequency.value = 440;
            oscillator.type = 'sine';
            gainNode.gain.value = 0.1;

            oscillator.start();
            setTimeout(() => oscillator.stop(), 200);
        } catch (e) {
            // 忽略音频错误
        }
    }

    // ============================================
    // 工具函数
    // ============================================
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }

    function formatMessageText(text) {
        if (!text) return '';
        // 转义 HTML
        let html = escapeHtml(text);
        // 转换换行
        html = html.replace(/\n/g, '<br>');
        // 转换 URL 为链接
        html = html.replace(
            /(https?:\/\/[^\s<]+)/g, 
            '<a href="$1" target="_blank" rel="noopener">$1</a>'
        );
        return html;
    }

    function getFileIcon(filename) {
        if (!filename) return '📎';
        const ext = filename.split('.').pop().toLowerCase();
        const iconMap = {
            pdf: '📕', doc: '📘', docx: '📘', xls: '📗', xlsx: '📗',
            ppt: '📙', pptx: '📙', zip: '📦', rar: '📦',
            mp3: '🎵', wav: '🎵', mp4: '🎬', mov: '🎬',
            jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', webp: '🖼️',
            txt: '📄', json: '📄', csv: '📄'
        };
        return iconMap[ext] || '📎';
    }

    function getContentTypeLabel(type) {
        const labels = { image: '图片', video: '视频', file: '文件', text: '文字' };
        return labels[type] || type;
    }

    function scrollToBottom() {
        requestAnimationFrame(() => {
            DOM.chatContainer.scrollTop = DOM.chatContainer.scrollHeight;
        });
    }

    function checkUrlParams() {
        const params = new URLSearchParams(window.location.search);
        const convId = params.get('conv');
        if (convId) {
            openConversation(convId);
        }
    }

    // ============================================
    // 暴露到全局（供 HTML onclick 使用）
    // ============================================
    window.ChatApp = {
        openConversation,
        removePendingFile: (index) => {
            State.pendingFiles.splice(index, 1);
            renderUploadPreview();
        }
    };

    // ============================================
    // 启动
    // ============================================
    document.addEventListener('DOMContentLoaded', init);

})();
