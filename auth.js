/**
 * TryToSeek - 认证模块
 * 处理登录、注册、登出、会话管理
 */

const Auth = {
    // 当前会话
    session: null,
    user: null,

    // 初始化认证状态监听
    init() {
        // 监听认证状态变化
        window.TryToSeek.supabase.auth.onAuthStateChange((event, session) => {
            console.log('Auth state changed:', event, session?.user?.email);
            this.session = session;
            this.user = session?.user || null;
            
            // 触发自定义事件
            window.dispatchEvent(new CustomEvent('auth:stateChanged', {
                detail: { event, session, user: this.user }
            }));
        });

        // 检查初始会话
        this.checkSession();
    },

    // 检查当前会话
    async checkSession() {
        const { data: { session } } = await window.TryToSeek.supabase.auth.getSession();
        this.session = session;
        this.user = session?.user || null;
        
        window.dispatchEvent(new CustomEvent('auth:ready', {
            detail: { session, user: this.user }
        }));
        
        return session;
    },

    // 邮箱注册
    async signUp(email, password, displayName) {
        const { data, error } = await window.TryToSeek.supabase.auth.signUp({
            email,
            password,
            options: {
                data: {
                    display_name: displayName || email.split('@')[0]
                }
            }
        });

        if (error) throw error;
        return data;
    },

    // 邮箱登录
    async signIn(email, password) {
        const { data, error } = await window.TryToSeek.supabase.auth.signInWithPassword({
            email,
            password
        });

        if (error) throw error;
        return data;
    },

    // 退出登录
    async signOut() {
        const { error } = await window.TryToSeek.supabase.auth.signOut();
        if (error) throw error;
        
        this.session = null;
        this.user = null;
        
        window.dispatchEvent(new CustomEvent('auth:signedOut'));
    },

    // 发送密码重置邮件
    async resetPassword(email) {
        const { error } = await window.TryToSeek.supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/reset-password.html`
        });
        if (error) throw error;
    },

    // 获取当前用户
    getCurrentUser() {
        return this.user;
    },

    // 是否已登录
    isAuthenticated() {
        return !!this.session;
    }
};

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    Auth.init();
});

// 导出到全局
window.Auth = Auth;
