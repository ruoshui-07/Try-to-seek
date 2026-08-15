/**
 * TryToSeek - 能工智人端逻辑
 * 
 * 核心功能：
 * 1. 能工智人登录验证
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
        sidebarOverlay: document.getElementById('sidebarOverlay'),
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
        confirmModal: document.getElementById('adminConfirmModal'),
        confirmModalTitle: document.getElementById('adminConfirmModalTitle'),
        confirmModalMessage: document.getElementById('adminConfirmModalMessage'),
        confirmModalCancel: document.getElementById('adminConfirmModalCancel'),
        confirmModalOk: document.getElementById('adminConfirmModalOk'),
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
            showToast('⚠️ 需要能工智人权限', 'error');
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
        // 侧边栏：桌面端折叠 / 移动端滑出
        DOM.sidebarToggle.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                const willOpen = !DOM.sidebar.classList.contains('open');
                DOM.sidebar.classList.toggle('open', willOpen);
                DOM.sidebarOverlay.classList.toggle('active', willOpen);
            } else {
                DOM.sidebar.classList.toggle('collapsed');
            }
        });

        // 移动端：点击遮罩关闭侧栏
        DOM.sidebarOverlay.addEventListener('click', () => {
            DOM.sidebar.classList.remove('open');
            DOM.sidebarOverlay.classList.remove('active');
        });

        // 移动端：选择对话后自动收起侧栏
        DOM.convList.addEventListener('click', (e) => {
            const item = e.target.closest('.user-list-item');
            if (item && window.innerWidth <= 768 && !e.target.closest('.conv-actions') && !e.target.closest('.conv-title-edit')) {
                DOM.sidebar.classList.remove('open');
                DOM.sidebarOverlay.classList.remove('active');
            }
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
                    profiles:user_id(email, display_name, deleted_at),
                    unread_msgs:messages(sender_type, is_read),
                    last_msg:messages(content, content_type, created_at, sender_type, is_read)
                `)
                .order('updated_at', { ascending: false });

            const { data, error } = await query;

            if (error) throw error;

            let conversations = data || [];

            // 给每条对话附加计算出的未读数（unread_msgs 数组 → 单值计数）
            conversations = conversations.map(conv => {
                const unread = (conv.unread_msgs || []).filter(m =>
                    m.sender_type === 'user' && !m.is_read
                ).length;
                // .messages 字段保留给 conversationsSignature / renderConversationList 里的旧逻辑
                return { ...conv, _unread: unread };
            });

            // 筛选未读
            if (filter === 'unread') {
                conversations = conversations.filter(conv => conv._unread > 0);
            }

            // 数据指纹比较：若数据无变化，跳过列表重渲染（避免侧栏抖动）
            const oldSig = conversationsSignature(State.conversations);
            const newSig = conversationsSignature(conversations);

            State.conversations = conversations;

            if (oldSig !== newSig) {
                // 保留侧边栏滚动位置
                const prevScrollTop = DOM.convList ? DOM.convList.scrollTop : 0;
                renderConversationList();
                if (DOM.convList) DOM.convList.scrollTop = prevScrollTop;
            }
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
            const isDeleted = !!conv.profiles?.deleted_at;
            const userEmail = conv.profiles?.email || '未知用户';
            const userName = isDeleted ? '已注销用户' : (conv.profiles?.display_name || userEmail.split('@')[0]);
            const displayTitle = conv.title || userName;
            const lastMsg = conv.last_msg?.[0];
            const preview = lastMsg
                ? (lastMsg.content_type === 'text'
                    ? lastMsg.content?.substring(0, 25)
                    : `[${getContentTypeLabel(lastMsg.content_type)}]`)
                : '暂无消息';

            const time = lastMsg ? window.TryToSeek.formatTime(lastMsg.created_at) : '';

            // 计算未读
            const unread = (typeof conv._unread === 'number')
                ? conv._unread
                : (conv.unread_msgs || []).filter(m =>
                    m.sender_type === 'user' && !m.is_read
                ).length || 0;

            const isActive = conv.id === State.currentConversationId;
            const avatarText = isDeleted ? '✕' : userName.charAt(0).toUpperCase();
            const titleColor = isDeleted ? 'var(--text-muted)' : 'var(--text-primary)';

            return `
                <div class="user-list-item ${isActive ? 'active' : ''}"
                     data-id="${conv.id}"
                     onclick="AdminApp.openConversation('${conv.id}')">
                    <div class="user-avatar" style="width:28px;height:28px;font-size:12px;${isDeleted ? 'background:var(--text-muted);' : ''}">
                        ${avatarText}
                    </div>
                    <div style="flex:1;overflow:hidden;min-width:0;">
                        <div class="user-email-text" style="font-size:12px;font-weight:500;color:${titleColor};" title="${escapeHtml(userEmail)}">
                            ${escapeHtml(displayTitle)}
                            ${isDeleted ? '<span style="font-size:10px;color:var(--text-muted);margin-left:4px;">（已注销）</span>' : ''}
                        </div>
                        <div style="font-size:11px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                            ${escapeHtml(preview)}
                        </div>
                    </div>
                    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;flex-shrink:0;">
                        <span style="font-size:10px;color:var(--text-muted);white-space:nowrap;">${time}</span>
                        ${unread > 0 ? `<span class="user-unread">${unread}</span>` : ''}
                        <div class="conv-actions" onclick="event.stopPropagation();">
                            <button class="conv-edit" title="重命名" onclick="AdminApp.editConversationTitle('${conv.id}')">✏️</button>
                            <button class="conv-delete" title="删除" onclick="AdminApp.deleteConversation('${conv.id}')">🗑️</button>
                        </div>
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
            const isDeleted = !!conv.profiles?.deleted_at;
            const userName = isDeleted ? '已注销用户' : (conv.profiles?.display_name || conv.profiles?.email?.split('@')[0] || '用户');
            const displayTitle = conv.title || userName;
            DOM.adminConvTitle.textContent = `与 ${displayTitle} 的对话`;
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

            const newMessages = data || [];
            const oldCount = State.messages.length;

            // 数据指纹比较：刷新时若数据无变化，跳过重渲染（避免抖动）
            const oldSig = messagesSignature(State.messages);
            const newSig = messagesSignature(newMessages);
            const hasChanged = oldSig !== newSig;

            State.messages = newMessages;

            // 检测新消息
            if (isRefresh && oldCount > 0 && newMessages.length > oldCount) {
                const newUserMsgs = newMessages.slice(oldCount)
                    .filter(m => m.sender_type === 'user');
                if (newUserMsgs.length > 0) {
                    showToast(`📬 收到 ${newUserMsgs.length} 条新消息`, 'success');
                }
            }

            // 仅在数据变化时重渲染（避免图片/视频被重建导致的闪烁）
            if (hasChanged || !isRefresh) {
                // 保留滚动位置
                const container = DOM.chatContainer;
                const prevScrollTop = container ? container.scrollTop : 0;
                const prevScrollHeight = container ? container.scrollHeight : 0;
                const atBottom = container
                    ? prevScrollTop + container.clientHeight >= prevScrollHeight - 50
                    : true;

                renderMessages();

                if (container) {
                    container.scrollTop = atBottom
                        ? container.scrollHeight
                        : prevScrollTop;
                }
            }

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

    // 生成消息列表的轻量指纹，用于检测数据是否变化
    function messagesSignature(msgs) {
        if (!msgs || msgs.length === 0) return '';
        return msgs.map(m => `${m.id}:${m.is_read ? 1 : 0}:${m.content || ''}`).join('|');
    }

    // 生成对话列表的轻量指纹，用于检测数据是否变化
    function conversationsSignature(convs) {
        if (!convs || convs.length === 0) return '';
        return convs.map(c => {
            const lastMsg = c.last_msg?.[0];
            const unreadCount = (typeof c._unread === 'number')
                ? c._unread
                : (c.unread_msgs || []).filter(m => m.sender_type === 'user' && !m.is_read).length || 0;
            return `${c.id}:${c.updated_at}:${unreadCount}:${lastMsg?.id || ''}:${lastMsg?.is_read ? 1 : 0}:${c.profiles?.deleted_at || ''}`;
        }).join('|');
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
        const senderName = isAdmin ? '我（能工智人）' : '用户';
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
                             data-type="image" loading="lazy">
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
                    sender_id: State.currentUser.id,   // ✨ 修复：添加 sender_id
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
                    sender_id: State.currentUser.id,   // ✨ 修复：添加 sender_id
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
        console.log('能工智人发送数据:', msgData);  // ✨ 添加日志便于调试
        const { error } = await window.TryToSeek.supabase
            .from('messages')
            .insert(msgData);
        if (error) {
            console.error('❌ 能工智人插入消息失败:', error);  // ✨ 详细错误日志
            throw error;
        }
    }

    // ============================================
    // 文件上传（能工智人）
    // ============================================
    async function handleAdminFileSelect(files) {
        for (const file of files) {
            const maxSize = TRYTOSEEK_CONFIG.APP.MAX_FILE_SIZE;
            const maxSizeMB = Math.round(maxSize / 1024 / 1024);
            if (file.size > maxSize) {
                showToast(`文件 "${file.name}" 超过 ${maxSizeMB}MB 限制`, 'error');
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
    // 改名 / 删除对话（管理员可操作任意对话）
    // ============================================
    async function updateConversationTitle(conversationId, title) {
        const { error } = await window.TryToSeek.supabase
            .from('conversations')
            .update({ title })
            .eq('id', conversationId);
        if (error) throw error;

        const conv = State.conversations.find(c => c.id === conversationId);
        if (conv) conv.title = title;
    }

    function editConversationTitle(conversationId) {
        const conv = State.conversations.find(c => c.id === conversationId);
        if (!conv) return;

        const convItemEl = DOM.convList.querySelector(
            `.user-list-item[data-id="${conversationId}"]`
        );
        if (!convItemEl) return;

        const nameEl = convItemEl.querySelector('.user-email-text');
        if (!nameEl) return;

        const userEmail = conv.profiles?.email || '未知用户';
        const userName = conv.profiles?.display_name || userEmail.split('@')[0];
        const oldTitle = conv.title || userName;

        // 把标题文本替换为输入框
        nameEl.outerHTML = `<input type="text" class="conv-title-edit user-email-text" 
            value="${escapeHtml(oldTitle).replace(/"/g, '&quot;')}" maxlength="50">`;

        const input = convItemEl.querySelector('.conv-title-edit');
        if (!input) return;

        input.addEventListener('click', (e) => e.stopPropagation());
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);

        let done = false;

        const submit = async () => {
            if (done) return;
            done = true;
            const newTitle = input.value.trim();
            if (!newTitle || newTitle === oldTitle) {
                renderConversationList();
                return;
            }
            try {
                await updateConversationTitle(conversationId, newTitle);
                await loadAllConversations();
                // 如果是当前对话，更新标题栏
                if (State.currentConversationId === conversationId) {
                    DOM.adminConvTitle.textContent = `与 ${newTitle} 的对话`;
                }
                showToast('标题已更新', 'success');
            } catch (e) {
                console.warn('标题更新失败:', e);
                showToast('更新失败: ' + e.message, 'error');
                renderConversationList();
            }
        };

        const cancel = () => {
            if (done) return;
            done = true;
            renderConversationList();
        };

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); submit(); }
            else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        });
        input.addEventListener('blur', () => {
            setTimeout(() => { if (!done) submit(); }, 150);
        });
    }

    async function deleteConversation(conversationId) {
        const conv = State.conversations.find(c => c.id === conversationId);
        if (!conv) return;

        const userEmail = conv.profiles?.email || '未知用户';
        const userName = conv.profiles?.display_name || userEmail.split('@')[0];
        const title = conv.title || userName;

        const confirmed = await showConfirmDialog({
            title: '删除对话',
            message: `确定要删除与"${title}"的对话吗？此操作无法撤销，所有消息记录都会被清除。`,
            okText: '删除',
            okType: 'danger'
        });
        if (!confirmed) return;

        try {
            const { error } = await window.TryToSeek.supabase
                .from('conversations')
                .delete()
                .eq('id', conversationId);
            if (error) throw error;

            State.conversations = State.conversations.filter(c => c.id !== conversationId);

            // 如果删除的是当前对话，回到欢迎页
            if (State.currentConversationId === conversationId) {
                State.currentConversationId = null;
                State.messages = [];
                DOM.adminConvTitle.textContent = '选择对话';
                DOM.welcomeScreen.style.display = 'flex';
                DOM.messagesList.style.display = 'none';
                DOM.inputArea.style.display = 'none';
            }

            renderConversationList();
            updateStats();
            showToast('对话已删除', 'success');
        } catch (e) {
            console.error('删除失败:', e);
            showToast('删除失败: ' + e.message, 'error');
        }
    }

    // 通用确认弹窗 Promise 封装
    function showConfirmDialog({ title, message, okText = '确认', cancelText = '取消', okType = 'primary' }) {
        return new Promise((resolve) => {
            if (!DOM.confirmModal) return resolve(false);

            DOM.confirmModalTitle.textContent = title || '确认';
            DOM.confirmModalMessage.textContent = message || '确定要执行此操作吗？';
            DOM.confirmModalCancel.textContent = cancelText;
            DOM.confirmModalOk.textContent = okText;
            DOM.confirmModalOk.className = 'confirm-modal-btn ' + (okType === 'danger' ? 'danger' : 'primary');

            let resolved = false;
            const cleanup = () => {
                DOM.confirmModal.classList.remove('active');
                DOM.confirmModalOk.removeEventListener('click', onOk);
                DOM.confirmModalCancel.removeEventListener('click', onCancel);
            };
            const onOk = () => { if (resolved) return; resolved = true; cleanup(); resolve(true); };
            const onCancel = () => { if (resolved) return; resolved = true; cleanup(); resolve(false); };

            DOM.confirmModalOk.addEventListener('click', onOk);
            DOM.confirmModalCancel.addEventListener('click', onCancel);
            DOM.confirmModal.classList.add('active');
        });
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

            // 本地同步：把对话的未读清零，避免依赖轮询才能消除红点
            const conv = State.conversations.find(c => c.id === convId);
            if (conv) {
                if (conv.unread_msgs) {
                    conv.unread_msgs = conv.unread_msgs.map(m => ({ ...m, is_read: true }));
                }
                conv._unread = 0;
                renderConversationList();
            }
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
        editConversationTitle,
        deleteConversation,
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
