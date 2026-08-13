/**
 * TryToSeek - 管理员端逻辑
 * 
 * 核心功能：
 * 1. 管理员登录验证
 * 2. 查看所有用户对话
 * 3. 回复用户消息（文字/图片/文件）
 * 4. 实时接收新消息
 * 5. 标记已读/未读
 * 6. 统计面板
 */

(function () {
    'use strict';

    // ---------- 状态管理 ----------
    const State = {
        currentUser: null,
        isAdmin: false,
        conversations: [],
        currentConversationId: null,
        messages: [],
        selectedUserId: null,
        pendingFiles: [],
        isTyping: false,
        draftContent: '',
        isLoading: false,
        realtimeChannel: null,
        pollInterval: null,
        unreadCount: 0,
    };

    // ---------- DOM 缓存 ----------
    const DOM = {
        sidebar: document.getElementById('sidebar'),
        sidebarToggle: document.getElementById('sidebarToggle'),
        convList: document.getElementById('adminConversationList'),
        userFilter: document.getElementById('userFilter'),
        adminConvTitle: document.getElementById('adminConvTitle'),
        unreadBadge: document.getElementById('unreadBadge'),
        chatContainer: document.getElementById('adminChatContainer'),
        welcomeScreen: document.getElementById('adminWelcome'),
        messagesList: document.getElementById('adminMessagesList'),
        inputArea: document.getElementById('adminInputArea'),
        messageInput: document.getElementById('adminMessageInput'),
        sendBtn: document.getElementById('adminSendBtn'),
        statusBanner: document.getElementById('adminStatusBanner'),
        statusText: document.getElementById('adminStatusText'),
        uploadPreview: document.getElementById('adminUploadPreview'),
        imageInput: document.getElementById('adminImageInput'),
        fileInput: document.getElementById('adminFileInput'),
        uploadImageBtn: document.getElementById('adminUploadImage'),
        uploadFileBtn: document.getElementById('adminUploadFile'),
        refreshBtn: document.getElementById('refreshAdmin'),
        markAllReadBtn: document.getElementById('markAllRead'),
        adminStats: document.getElementById('adminStats'),
        adminAvatar: document.getElementById('adminAvatar'),
        adminName: document.getElementById('adminName'),
        adminEmail: document.getElementById('adminEmail'),
        adminInfoBtn: document.getElementById('adminInfoBtn'),
        adminDropdown: document.getElementById('adminDropdown'),
        adminLogout: document.getElementById('adminLogout'),
        backToUser: document.getElementById('backToUser'),
        mediaModal: document.getElementById('adminMediaModal'),
        modalClose: document.getElementById('adminModalClose'),
        modalContent: document.getElementById('adminModalContent'),
        toastContainer: document.getElementById('adminToastContainer'),
    };

    // ============================================
    // 初始化
    // ============================================
    async function init() {
        await waitForAuth();

        if (!Auth.isAuthenticated()) {
            window.location.href = 'login.html';
            return;
        }

        State.currentUser = Auth.getCurrentUser();
        State.isAdmin = await window.TryToSeek.isAdmin();

        // 权限检查
        if (!State.isAdmin) {
            showToast('⚠️ 需要管理员权限', 'error');
            setTimeout(() => window.location.href = 'index.html', 2000);
            return;
        }

        initUI();
        initEventListeners();
        await loadAllConversations();
        updateStats();

        // 启动实时订阅
        startRealtimeSubscription();

        // 启动轮询
        startPolling();
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
        const name = user.email?.split('@')[0] || 'Admin';
        DOM.adminName.textContent = name;
        DOM.adminEmail.textContent = user.email || '';
        DOM.adminAvatar.textContent = name.charAt(0).toUpperCase();

        // 恢复草稿
        const draft = localStorage.getItem('trytoseek_admin_draft');
        if (draft) {
            DOM.messageInput.value = draft;
            autoResizeTextarea();
        }
    }

    function initEventListeners() {
        // 侧边栏
        DOM.sidebarToggle.addEventListener('click', () => {
            DOM.sidebar.classList.toggle('open');
        });

        // 筛选器
        DOM.userFilter.addEventListener('change', () => {
            loadAllConversations();
        });

        // 发送
        DOM.sendBtn.addEventListener('click', sendReply);
        DOM.messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendReply();
            }
        });
        DOM.messageInput.addEventListener('input', handleInputChange);
        DOM.messageInput.addEventListener('focus', () => { State.isTyping = true; });
        DOM.messageInput.addEventListener('blur', () => { State.isTyping = false; });

        // 文件上传
        DOM.uploadImageBtn.addEventListener('click', () => DOM.imageInput.click());
        DOM.uploadFileBtn.addEventListener('click', () => DOM.fileInput.click());
        DOM.imageInput.addEventListener('change', (e) => handleAdminFileSelect(e.target.files));
        DOM.fileInput.addEventListener('change', (e) => handleAdminFileSelect(e.target.files));

        // 刷新
        DOM.refreshBtn.addEventListener('click', () => {
            if (State.currentConversationId) {
                loadMessages(State.currentConversationId, true);
            }
            loadAllConversations();
            updateStats();
            showToast('已刷新', 'info');
        });

        // 全部标为已读
        DOM.markAllReadBtn.addEventListener('click', async () => {
            await markAllMessagesRead();
        });

        // 用户菜单
        DOM.adminInfoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            DOM.adminDropdown.classList.toggle('active');
        });
        document.addEventListener('click', () => {
            DOM.adminDropdown.classList.remove('active');
        });

        // 退出
        DOM.adminLogout.addEventListener('click', async () => {
            await Auth.signOut();
            window.location.href = 'login.html';
        });

        // 返回用户端
        DOM.backToUser.addEventListener('click', () => {
            window.location.href = 'index.html';
        });

        // 模态框
        DOM.modalClose.addEventListener('click', closeMediaModal);
        DOM.mediaModal.addEventListener('click', (e) => {
            if (e.target === DOM.mediaModal) closeMediaModal();
        });

        // 页面可见性
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && State.currentConversationId) {
                loadMessages(State.currentConversationId, true);
            }
        });

        // 防止意外关闭
        window.addEventListener('beforeunload', () => {
            saveDraft();
        });
    }

    // ============================================
    // 加载所有对话
    // ============================================
    async function loadAllConversations() {
        try {
            const filter = DOM.userFilter.value;

            let query = window.TryToSeek.supabase
                .from('conversations')
                .select(`
                    *,
                    profiles:user_id(email, display_name),
                    messages:messages(count),
                    last_msg:messages(content, content_type, created_at, sender_type, is_read)
                `)
                .order('updated_at', { ascending: false });

            const { data, error } = await query;

            if (error) throw error;

            let conversations = data || [];

            // 筛选未读
            if (filter === 'unread') {
                conversations = conversations.filter(conv => {
                    const unread = conv.messages?.filter(m => 
                        m.sender_type === 'user' && !m.is_read
                    ).length;
                    return unread > 0;
                });
            }

            State.conversations = conversations;
            renderConversationList();
            updateUnreadBadge();
        } catch (error) {
            console.error('加载对话失败:', error);
            showToast('加载对话失败', 'error');
        }
    }

    function renderConversationList() {
        if (State.conversations.length === 0) {
            DOM.convList.innerHTML = `
                <div class="empty-state" style="padding:20px;font-size:12px;">
                    <div class="empty-state-icon">📭</div>
                    ${DOM.userFilter.value === 'unread' ? '没有未读消息' : '暂无用户对话'}
                </div>
            `;
            return;
        }

        DOM.convList.innerHTML = State.conversations.map(conv => {
            const userEmail = conv.profiles?.email || '未知用户';
            const userName = conv.profiles?.display_name || userEmail.split('@')[0];
            const lastMsg = conv.last_msg?.[0];
            const preview = lastMsg
                ? (lastMsg.content_type === 'text'
                    ? lastMsg.content?.substring(0, 25)
                    : `[${getContentTypeLabel(lastMsg.content_type)}]`)
                : '暂无消息';

            const time = lastMsg ? window.TryToSeek.formatTime(lastMsg.created_at) : '';
            
            // 计算未读
            const unread = conv.messages?.filter(m => 
                m.sender_type === 'user' && !m.is_read
            ).length || 0;

            const isActive = conv.id === State.currentConversationId;

            return `
                <div class="user-list-item ${isActive ? 'active' : ''}" 
                     data-id="${conv.id}"
                     onclick="AdminApp.openConversation('${conv.id}')">
                    <div class="user-avatar" style="width:28px;height:28px;font-size:12px;">
                        ${userName.charAt(0).toUpperCase()}
                    </div>
                    <div style="flex:1;overflow:hidden;">
                        <div class="user-email-text" style="font-size:12px;font-weight:500;">
                            ${escapeHtml(userName)}
                        </div>
                        <div style="font-size:11px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                            ${escapeHtml(preview)}
                        </div>
                    </div>
                    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;">
                        <span style="font-size:10px;color:var(--text-muted);white-space:nowrap;">${time}</span>
                        ${unread > 0 ? `<span class="user-unread">${unread}</span>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    // ============================================
    // 打开对话
    // ============================================
    async function openConversation(convId) {
        State.currentConversationId = convId;
        const conv = State.conversations.find(c => c.id === convId);

        if (conv) {
            const userName = conv.profiles?.display_name || conv.profiles?.email?.split('@')[0] || '用户';
            DOM.adminConvTitle.textContent = `与 ${userName} 的对话`;
        }

        // 更新列表激活状态
        document.querySelectorAll('.user-list-item').forEach(el => {
            el.classList.toggle('active', el.dataset.id === convId);
        });

        // 显示输入区域
        DOM.welcomeScreen.style.display = 'none';
        DOM.messagesList.style.display = 'block';
        DOM.inputArea.style.display = 'block';

        // 恢复该对话的草稿
        restoreDraftForConversation(convId);

        // 加载消息
        await loadMessages(convId);

        // 滚动到底部
        scrollToBottom();
    }

    // ============================================
    // 加载消息
    // ============================================
    async function loadMessages(convId, isRefresh = false) {
        if (State.isLoading) return;
        State.isLoading = true;

        try {
            const { data, error } = await window.TryToSeek.supabase
                .from('messages')
                .select('*')
                .eq('conversation_id', convId)
                .order('created_at', { ascending: true });

            if (error) throw error;

            const oldCount = State.messages.length;
            State.messages = data || [];

            // 检测新消息
            if (isRefresh && oldCount > 0 && State.messages.length > oldCount) {
                const newUserMsgs = State.messages.slice(oldCount)
                    .filter(m => m.sender_type === 'user');
                if (newUserMsgs.length > 0) {
                    showToast(`📬 收到 ${newUserMsgs.length} 条新消息`, 'success');
                }
            }

            renderMessages();

            // 标记用户消息为已读
            await markConversationAsRead(convId);

            // 更新对话列表
            await loadAllConversations();

        } catch (error) {
            console.error('加载消息失败:', error);
        } finally {
            State.isLoading = false;
        }
    }

    function renderMessages() {
        if (State.messages.length === 0) {
            DOM.messagesList.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">💬</div>
                    暂无消息<br>
                    <small style="margin-top:8px;display:block;color:var(--text-muted);">
                        发送回复开始对话
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
                ${group.messages.map(msg => renderAdminMessage(msg)).join('')}
            </div>
        `).join('');

        bindAdminAttachmentEvents();
    }

    function renderAdminMessage(msg) {
        const isAdmin = msg.sender_type === 'admin';
        const time = window.TryToSeek.formatTime(msg.created_at);
        const senderName = isAdmin ? '我（管理员）' : '用户';
        const avatarText = isAdmin ? 'A' : 'U';

        let contentHtml = '';

        if (msg.content_type === 'text') {
            contentHtml = `<div class="message-bubble">${formatMessageText(msg.content)}</div>`;
        } else if (msg.content_type === 'image') {
            contentHtml = `
                <div class="message-bubble">
                    ${msg.content ? `<p>${escapeHtml(msg.content)}</p>` : ''}
                    <div class="message-attachments">
                        <img src="${msg.content}" alt="${escapeHtml(msg.file_name || '')}" 
                             class="attachment-image" data-src="${msg.content}" 
                             data-type="image" loading="lazy" style="max-width:200px;">
                    </div>
                </div>
            `;
        } else if (msg.content_type === 'video') {
            contentHtml = `
                <div class="message-bubble">
                    ${msg.content ? `<p>${escapeHtml(msg.content)}</p>` : ''}
                    <video src="${msg.content}" controls preload="metadata" 
                           style="max-width:250px;border-radius:8px;"></video>
                </div>
            `;
        } else {
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
            <div class="message ${isAdmin ? 'admin' : 'user'}" data-id="${msg.id}">
                <div class="message-avatar">${avatarText}</div>
                <div class="message-content">
                    <div class="message-header">
                        <span class="message-sender">${senderName}</span>
                        <span class="message-time">${time}</span>
                        ${msg.is_read && isAdmin ? '<span style="font-size:10px;color:var(--accent);">✓ 已读</span>' : ''}
                    </div>
                    ${contentHtml}
                </div>
            </div>
        `;
    }

    // ============================================
    // 发送回复
    // ============================================
    async function sendReply() {
        const text = DOM.messageInput.value.trim();
        const hasFiles = State.pendingFiles.length > 0;

        if (!text && !hasFiles) return;
        if (!State.currentConversationId) {
            showToast('请先选择一个对话', 'error');
            return;
        }

        const filesToSend = [...State.pendingFiles];
        State.pendingFiles = [];
        clearUploadPreview();

        // 清空输入
        DOM.messageInput.value = '';
        autoResizeTextarea();
        saveDraft();

        try {
            // 发送文字
            if (text) {
                await insertAdminMessage({
                    conversation_id: State.currentConversationId,
                    sender_type: 'admin',
                    content_type: 'text',
                    content: text
                });
            }

            // 发送文件
            for (const fileData of filesToSend) {
                const { file, url } = fileData;
                const contentType = file.type.startsWith('image/') ? 'image'
                                 : file.type.startsWith('video/') ? 'video'
                                 : 'file';

                await insertAdminMessage({
                    conversation_id: State.currentConversationId,
                    sender_type: 'admin',
                    content_type: contentType,
                    content: url,
                    file_name: file.name,
                    file_size: file.size,
                    file_mime_type: file.type
                });
            }

            // 更新对话 updated_at
            await window.TryToSeek.supabase
                .from('conversations')
                .update({ updated_at: new Date().toISOString() })
                .eq('id', State.currentConversationId);

            // 重新加载
            await loadMessages(State.currentConversationId);
            await loadAllConversations();
            updateStats();

            showToast('✓ 回复已发送', 'success');
        } catch (error) {
            console.error('发送失败:', error);
            showToast('发送失败: ' + error.message, 'error');
        }
    }

    async function insertAdminMessage(msgData) {
        const { error } = await window.TryToSeek.supabase
            .from('messages')
            .insert(msgData);
        if (error) throw error;
    }

    // ============================================
    // 文件上传（管理员）
    // ============================================
    async function handleAdminFileSelect(files) {
        for (const file of files) {
            if (file.size > 25 * 1024 * 1024) {
                showToast(`文件 "${file.name}" 超过 25MB 限制`, 'error');
                continue;
            }

            try {
                showToast(`正在上传 ${file.name}...`, 'info');

                const fileExt = file.name.split('.').pop();
                const fileName = `admin/${State.currentUser.id}/${Date.now()}-${Math.random().toString(36).substr(2, 9)}.${fileExt}`;

                const { data, error } = await window.TryToSeek.supabase.storage
                    .from(window.TryToSeek.STORAGE_BUCKET)
                    .upload(fileName, file, { cacheControl: '3600', upsert: false });

                if (error) throw error;

                const { data: urlData } = window.TryToSeek.supabase.storage
                    .from(window.TryToSeek.STORAGE_BUCKET)
                    .getPublicUrl(fileName);

                State.pendingFiles.push({ file, url: urlData.publicUrl });
                showToast(`${file.name} ready`, 'success');
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
                ? `<img src="${URL.createObjectURL(item.file)}" style="width:32px;height:32px;object-fit:cover;border-radius:4px;">`
                : `<span style="font-size:18px;">${getFileIcon(item.file.name)}</span>`;

            return `
                <div class="upload-preview-item">
                    ${preview}
                    <span class="upload-preview-name">${escapeHtml(item.file.name)}</span>
                    <button class="upload-preview-remove" onclick="AdminApp.removePendingFile(${index})">&times;</button>
                </div>
            `;
        }).join('');
    }

    // ============================================
    // 标记已读
    // ============================================
    async function markConversationAsRead(convId) {
        try {
            const { error } = await window.TryToSeek.supabase
                .from('messages')
                .update({ is_read: true })
                .eq('conversation_id', convId)
                .eq('sender_type', 'user')
                .eq('is_read', false);

            if (error) throw error;
        } catch (e) {
            console.warn('标记已读失败:', e);
        }
    }

    async function markAllMessagesRead() {
        try {
            const { error } = await window.TryToSeek.supabase
                .from('messages')
                .update({ is_read: true })
                .eq('sender_type', 'user')
                .eq('is_read', false);

            if (error) throw error;

            showToast('✓ 全部已标为已读', 'success');
            await loadAllConversations();
            updateUnreadBadge();
        } catch (e) {
            showToast('操作失败', 'error');
        }
    }

    // ============================================
    // 统计面板
    // ============================================
    async function updateStats() {
        try {
            // 总对话数
            const { count: totalConvs } = await window.TryToSeek.supabase
                .from('conversations')
                .select('*', { count: 'exact', head: true });

            // 总消息数
            const { count: totalMsgs } = await window.TryToSeek.supabase
                .from('messages')
                .select('*', { count: 'exact', head: true });

            // 未读消息数
            const { count: unreadMsgs } = await window.TryToSeek.supabase
                .from('messages')
                .select('*', { count: 'exact', head: true })
                .eq('sender_type', 'user')
                .eq('is_read', false);

            // 总用户数
            const { count: totalUsers } = await window.TryToSeek.supabase
                .from('profiles')
                .select('*', { count: 'exact', head: true });

            DOM.adminStats.innerHTML = `
                <div>👥 总用户数: <strong style="color:var(--text-primary);">${totalUsers || 0}</strong></div>
                <div>💬 总对话数: <strong style="color:var(--text-primary);">${totalConvs || 0}</strong></div>
                <div>📨 总消息数: <strong style="color:var(--text-primary);">${totalMsgs || 0}</strong></div>
                <div>🔴 未读消息: <strong style="color:${unreadMsgs > 0 ? 'var(--danger)' : 'var(--text-primary)'};">${unreadMsgs || 0}</strong></div>
            `;

            State.unreadCount = unreadMsgs || 0;
            updateUnreadBadge();
        } catch (e) {
            DOM.adminStats.innerHTML = '<div style="color:var(--danger);">统计加载失败</div>';
        }
    }

    function updateUnreadBadge() {
        if (State.unreadCount > 0) {
            DOM.unreadBadge.style.display = 'inline-block';
            DOM.unreadBadge.textContent = `${State.unreadCount} 未读`;
        } else {
            DOM.unreadBadge.style.display = 'none';
        }
    }

    // ============================================
    // 实时订阅
    // ============================================
    function startRealtimeSubscription() {
        if (State.realtimeChannel) {
            State.realtimeChannel.unsubscribe();
        }

        State.realtimeChannel = window.TryToSeek.supabase
            .channel('admin-messages-changes')
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'messages'
                },
                (payload) => {
                    console.log('[Admin Realtime] 新消息:', payload);
                    
                    const newMsg = payload.new;

                    // 如果是当前对话的消息
                    if (newMsg.conversation_id === State.currentConversationId) {
                        const exists = State.messages.some(m => m.id === newMsg.id);
                        if (!exists) {
                            State.messages.push(newMsg);
                            renderMessages();
                            scrollToBottom();
                            // 自动标记已读
                            markConversationAsRead(State.currentConversationId);
                        }
                    }

                    // 刷新列表和统计
                    loadAllConversations();
                    updateStats();
                }
            )
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'messages'
                },
                () => {
                    if (State.currentConversationId) {
                        loadMessages(State.currentConversationId, true);
                    }
                }
            )
            .subscribe();
    }

    // ============================================
    // 轮询
    // ============================================
    function startPolling() {
        stopPolling();
        State.pollInterval = setInterval(async () => {
            if (State.isTyping) return;

            if (document.visibilityState === 'visible') {
                await loadAllConversations();
                updateStats();
                if (State.currentConversationId) {
                    await loadMessages(State.currentConversationId, true);
                }
            }
        }, 10000); // 每10秒
    }

    function stopPolling() {
        if (State.pollInterval) {
            clearInterval(State.pollInterval);
            State.pollInterval = null;
        }
    }

    // ============================================
    // 输入处理 & 草稿管理
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

    function autoResizeTextarea() {
        DOM.messageInput.style.height = 'auto';
        DOM.messageInput.style.height = Math.min(DOM.messageInput.scrollHeight, 200) + 'px';
    }

    function saveDraft() {
        const draft = DOM.messageInput.value;
        if (State.currentConversationId) {
            localStorage.setItem(`trytoseek_admin_draft_${State.currentConversationId}`, draft);
        }
        localStorage.setItem('trytoseek_admin_draft', draft);
    }

    function restoreDraftForConversation(convId) {
        const draft = localStorage.getItem(`trytoseek_admin_draft_${convId}`);
        DOM.messageInput.value = draft || '';
        autoResizeTextarea();
    }

    function clearUploadPreview() {
        DOM.uploadPreview.classList.remove('active');
        DOM.uploadPreview.innerHTML = '';
    }

    // ============================================
    // 媒体模态框
    // ============================================
    function bindAdminAttachmentEvents() {
        document.querySelectorAll('#adminMessagesList .attachment-image').forEach(img => {
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
    // Toast
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
        html = html.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
        return html;
    }

    function getFileIcon(filename) {
        if (!filename) return '📎';
        const ext = filename.split('.').pop().toLowerCase();
        const iconMap = {
            pdf: '📕', doc: '📘', docx: '📘', xls: '📗', xlsx: '📗',
            ppt: '📙', pptx: '📙', zip: '📦', rar: '📦',
            mp3: '🎵', wav: '🎵', mp4: '🎬', mov: '🎬',
            jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️',
            txt: '📄'
        };
        return iconMap[ext] || '📎';
    }

    function getContentTypeLabel(type) {
        const labels = { image: '图片', video: '视频', file: '文件', text: '文字' };
        return labels[type] || type;
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
        return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
    }

    function scrollToBottom() {
        requestAnimationFrame(() => {
            DOM.chatContainer.scrollTop = DOM.chatContainer.scrollHeight;
        });
    }

    // ============================================
    // 暴露全局
    // ============================================
    window.AdminApp = {
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
