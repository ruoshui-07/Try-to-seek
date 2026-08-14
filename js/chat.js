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
    // 安全垫函数
    // ============================================
    function clearUploadPreview() {
        // 空函数，防止调用报错
    }

    // ============================================
    // 初始化（⭐ 修改点1：不自动打开对话）
    // ============================================
    async function init() {
        await waitForAuth();

        if (!Auth.isAuthenticated()) {
            window.location.href = 'login.html';
            return;
        }

        State.currentUser = Auth.getCurrentUser();
        State.isAdmin = await window.TryToSeek.isAdmin();

        initUI();
        initEventListeners();

        // 加载对话列表（仅用于左侧显示，不自动跳转）
        await loadConversations();

        // ⭐ 修改：不再自动打开第一个对话，保持欢迎页显示
        // 原来代码：
        // if (State.conversations.length > 0) {
        //     openConversation(State.conversations[0].id);
        // } else {
        //     await createNewConversation();
        // }
        // 改为：
        // 保持 welcomeScreen 显示，messagesList 隐藏
        DOM.welcomeScreen.style.display = 'flex'; // 确保欢迎页可见
        DOM.messagesList.style.display = 'none';
        DOM.messageInput.disabled = false;        // 输入框可用
        DOM.sendBtn.disabled = false;              // 发送按钮可用

        // 启动实时监听和轮询（但轮询内部会判断 currentConversationId，不会误操作）
        startRealtimeSubscription();
        startPolling();
        checkUrlParams();
    }

    function waitForAuth() {
        return new Promise((resolve) => {
            if (Auth.getCurrentUser()) return resolve();
            window.addEventListener('auth:ready', () => resolve(), { once: true });
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

        if (user.user_metadata?.avatar_url) {
            DOM.userAvatar.innerHTML = `<img src="${user.user_metadata.avatar_url}" alt="avatar">`;
        }

        if (State.isAdmin) {
            DOM.goToAdmin.style.display = 'flex';
            DOM.adminDivider.style.display = 'block';
        }

        const savedTheme = localStorage.getItem('trytoseek_theme') || 'dark';
        setTheme(savedTheme);

        const savedDraft = localStorage.getItem('trytoseek_draft');
        if (savedDraft) {
            DOM.messageInput.value = savedDraft;
            autoResizeTextarea();
        }
    }

    function initEventListeners() {
        DOM.sidebarToggle.addEventListener('click', () => {
            DOM.sidebar.classList.toggle('open');
        });

        DOM.newChatBtn.addEventListener('click', () => {
            createNewConversation();
        });

        DOM.sendBtn.addEventListener('click', sendMessage);

        DOM.messageInput.addEventListener('input', handleInputChange);
        DOM.messageInput.addEventListener('keydown', handleKeyDown);
        DOM.messageInput.addEventListener('focus', () => { State.isTyping = true; });
        DOM.messageInput.addEventListener('blur', () => { State.isTyping = false; });

        DOM.uploadImageBtn.addEventListener('click', () => DOM.imageInput.click());
        DOM.uploadFileBtn.addEventListener('click', () => DOM.fileInput.click());
        DOM.imageInput.addEventListener('change', (e) => handleFileSelect(e.target.files, 'image'));
        DOM.fileInput.addEventListener('change', (e) => handleFileSelect(e.target.files, 'file'));

        DOM.refreshBtn.addEventListener('click', () => {
    if (State.currentConversationId) {
        loadMessages(State.currentConversationId, true, true); // 强制刷新
        showToast('已刷新', 'info');
    }
});

        DOM.userInfoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            DOM.userDropdown.classList.toggle('active');
        });

        document.addEventListener('click', () => {
            DOM.userDropdown.classList.remove('active');
        });

        DOM.logoutBtn.addEventListener('click', async () => {
            await Auth.signOut();
            window.location.href = 'login.html';
        });

        DOM.themeToggle.addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-theme') || 'dark';
            const next = current === 'dark' ? 'light' : 'dark';
            setTheme(next);
        });

        DOM.goToAdmin.addEventListener('click', () => {
            window.location.href = 'admin.html';
        });

        DOM.modalClose.addEventListener('click', closeMediaModal);
        DOM.mediaModal.addEventListener('click', (e) => {
            if (e.target === DOM.mediaModal) closeMediaModal();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeMediaModal();
                DOM.userDropdown.classList.remove('active');
            }
        });

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && State.currentConversationId) {
                loadMessages(State.currentConversationId, true);
            }
        });

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

        document.querySelectorAll('.conversation-item').forEach(el => {
            el.classList.toggle('active', el.dataset.id === conversationId);
        });

        DOM.welcomeScreen.style.display = 'none';
        DOM.messagesList.style.display = 'block';
        DOM.messageInput.disabled = false;
        DOM.sendBtn.disabled = false;

        await loadMessages(conversationId);
        scrollToBottom();
    }

    // ============================================
    // 消息管理（核心修改：冻结滚动 + 增量追加）
    // ============================================
    async function loadMessages(conversationId, isRefresh = false, force = false) {
    if (State.isLoading) return;
    State.isLoading = true;

    try {
        const { data, error } = await window.TryToSeek.supabase
            .from('messages')
            .select('*')
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: true });

        if (error) throw error;

        // ✨ 轮询且无新消息且非强制刷新 → 直接跳过渲染
        if (isRefresh && !force && data.length === State.messages.length) {
            State.messages = data; // 同步状态（如有已读标记变化可在此更新）
            State.isLoading = false;
            return;
        }

        // 有变化 → 固定高度、隐藏、渲染/追加、恢复
        const chatContainer = DOM.chatContainer;
        const containerHeight = chatContainer.offsetHeight;
        if (containerHeight > 0) {
            chatContainer.style.minHeight = containerHeight + 'px';
        }
        DOM.messagesList.style.visibility = 'hidden';
        const prevScrollTop = chatContainer.scrollTop;
        const prevScrollHeight = chatContainer.scrollHeight;

        const oldCount = State.messages.length;
        const newCount = data.length;
        const hasNewMessages = newCount > oldCount;

        if (isRefresh && hasNewMessages && oldCount > 0) {
            const newMsgs = data.slice(oldCount);
            State.messages = data;
            appendNewMessages(newMsgs);
        } else {
            State.messages = data;
            renderMessages();
        }

        State.lastMessageCount = State.messages.length;
        markMessagesAsRead(conversationId);

        // 恢复滚动
        if (prevScrollTop + chatContainer.clientHeight >= prevScrollHeight - 50) {
            scrollToBottom();
        } else {
            chatContainer.scrollTop = prevScrollTop;
        }

    } catch (error) {
        console.error('加载消息失败:', error);
        if (!isRefresh) showToast('加载消息失败: ' + error.message, 'error');
    } finally {
        State.isLoading = false;
        DOM.messagesList.style.visibility = 'visible';
        chatContainer.style.minHeight = '';
    }
}

    // ✨ 新增：增量追加新消息到列表末尾
    function appendNewMessages(newMsgs) {
        // 获取最后一个日期分组
        let lastGroup = DOM.messagesList.querySelector('.message-group:last-child');
        let groupEl = lastGroup;

        newMsgs.forEach((msg, index) => {
            const msgDate = new Date(msg.created_at).toDateString();
            const lastGroupDate = groupEl ? 
                groupEl.querySelector('.message-date-divider span')?.textContent : null;

            // 判断是否需要新建日期分组
            const needsNewGroup = !groupEl || 
                (index === 0 && lastGroupDate !== formatDateLabel(new Date(msg.created_at)));

            if (needsNewGroup) {
                const groupDiv = document.createElement('div');
                groupDiv.className = 'message-group';
                groupDiv.innerHTML = `
                    <div class="message-date-divider">
                        <span>${formatDateLabel(new Date(msg.created_at))}</span>
                    </div>
                `;
                DOM.messagesList.appendChild(groupDiv);
                groupEl = groupDiv;
            }

            // 追加消息元素
            const msgWrapper = document.createElement('div');
            msgWrapper.innerHTML = renderMessage(msg);
            const msgElement = msgWrapper.firstElementChild;
            if (msgElement) {
                groupEl.appendChild(msgElement);
            }
        });

        // 重新绑定附件点击事件
        bindAttachmentEvents();
    }

    // 全量渲染（首次加载或手动刷新时使用）
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

        const groups = groupMessagesByDate(State.messages);

        DOM.messagesList.innerHTML = groups.map(group => `
            <div class="message-group">
                <div class="message-date-divider">
                    <span>${group.dateLabel}</span>
                </div>
                ${group.messages.map(msg => renderMessage(msg)).join('')}
            </div>
        `).join('');

        bindAttachmentEvents();
        scrollToBottom();
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
    // 发送消息（⭐ 修改点2：首次发送时创建对话并跳转）
    // ============================================
    async function sendMessage() {
        const text = DOM.messageInput.value.trim();
        const hasFiles = State.pendingFiles.length > 0;

        if (!text && !hasFiles) return;

        // ⭐ 新增：如果没有当前对话，先创建一个新对话并跳转到消息列表
        if (!State.currentConversationId) {
            // 先创建一个新对话（使用 createNewConversation 会调用 openConversation，但我们会稍作调整）
            // 为了避免 createNewConversation 中重复的 openConversation 逻辑，我们在这里直接实现
            try {
                const title = text ? text.substring(0, 30) : '新对话';
                const { data, error } = await window.TryToSeek.supabase
                    .from('conversations')
                    .insert({
                        user_id: State.currentUser.id,
                        title: title,
                        status: 'active'
                    })
                    .select()
                    .single();

                if (error) throw error;

                // 添加到对话列表并渲染
                State.conversations.unshift(data);
                renderConversationList();

                // 打开这个新对话（隐藏欢迎页，显示消息列表）
                await openConversation(data.id);

            } catch (error) {
                console.error('创建对话失败:', error);
                showToast('创建对话失败: ' + error.message, 'error');
                return;
            }
        }

        const filesToSend = [...State.pendingFiles];
        State.pendingFiles = [];

        DOM.messageInput.value = '';
        autoResizeTextarea();
        saveDraft();

        try {
            if (text) {
                await insertMessage({
                    conversation_id: State.currentConversationId,
                    sender_type: 'user',
                    sender_id: State.currentUser.id,
                    content_type: 'text',
                    content: text
                });

                const conv = State.conversations.find(c => c.id === State.currentConversationId);
                if (conv && conv.title === '新对话') {
                    const title = window.TryToSeek.generateTitle(text);
                    await updateConversationTitle(State.currentConversationId, title);
                }
            }

            for (const fileData of filesToSend) {
                const { file, url } = fileData;
                const contentType = file.type.startsWith('image/') ? 'image' 
                                   : file.type.startsWith('video/') ? 'video' 
                                   : 'file';

                await insertMessage({
                    conversation_id: State.currentConversationId,
                    sender_type: 'user',
                    sender_id: State.currentUser.id,
                    content_type: contentType,
                    content: url,
                    file_name: file.name,
                    file_size: file.size,
                    file_mime_type: file.type
                });
            }

            await loadMessages(State.currentConversationId);
            await loadConversations();

            showStatusBanner('info', '✉️ 消息已发送，管理员会在看到后回复你');
            setTimeout(hideStatusBanner, 5000);

        } catch (error) {
            console.error('发送失败:', error);
            showToast('发送失败: ' + error.message, 'error');
        }
    }
    
    async function insertMessage(msgData) {
        console.log('准备发送到 Supabase 的数据:', msgData);

        const { error } = await window.TryToSeek.supabase
            .from('messages')
            .insert(msgData);

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
            if (file.size > 25 * 1024 * 1024) {
                showToast(`文件 "${file.name}" 超过 25MB 限制`, 'error');
                continue;
            }

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
            if (State.isTyping) {
                console.log('[Polling] 用户正在输入，跳过');
                return;
            }

            if (State.currentConversationId && document.visibilityState === 'visible') {
                await loadMessages(State.currentConversationId, true); // force 默认为 false
            }
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
                if (payload.new.conversation_id === State.currentConversationId) {
                    const exists = State.messages.some(m => m.id === payload.new.id);
                    if (!exists) {
                        State.messages.push(payload.new);
                        
                        // ✅ 修改点1：改为增量追加（只添加这一条新消息）
                        appendNewMessages([payload.new]);

                        // ✅ 如果用户当前在底部，自动滚动到底部
                        const container = DOM.chatContainer;
                        const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 20;
                        if (atBottom) scrollToBottom();

                        if (payload.new.sender_type === 'admin') {
                            showToast('📬 管理员回复了你！', 'success');
                            playNotificationSound();
                        }
                    }
                }
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
                // ✅ 修改点2：注释掉全量刷新，避免抖动
                // 如果将来需要更新“已读”状态，可以单独修改对应 DOM 元素，这里暂不处理
                // if (State.currentConversationId) {
                //     loadMessages(State.currentConversationId, true);
                // }
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
    // 输入处理
    // ============================================
    function handleInputChange() {
        autoResizeTextarea();
        saveDraft();
        State.isTyping = true;

        clearTimeout(State.typingTimeout);
        State.typingTimeout = setTimeout(() => {
            State.isTyping = false;
        }, 2000);
    }

    function handleKeyDown(e) {
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
        let html = escapeHtml(text);
        html = html.replace(/\n/g, '<br>');
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
    // 暴露全局
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
