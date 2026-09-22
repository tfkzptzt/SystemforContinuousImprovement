/* ============================================================
 * views/my-account.js —— 我的账户（修改密码 + 钉钉绑定）
 * ============================================================ */
window.VIEWS.MyAccount = {
  name: 'MyAccount',
  template: `
  <div class="page">
    <div class="page-head">
      <h2 class="page-title">我的账户</h2>
    </div>

    <div class="account-layout">
      <!-- 首次登录强制改密提示 -->
      <div class="notice notice-red" v-if="mustChange" style="margin-bottom:4px;">
        <span class="n-ico">!</span>
        <div>您正在使用系统生成的初始密码，为保障账号安全，<b>请先在下方修改密码</b>后再使用其它功能。</div>
      </div>

      <!-- 用户信息卡片 -->
      <div class="card">
        <h3 class="card-title">账户信息</h3>
        <div class="account-info">
          <div class="account-avatar">{{ avatarChar }}</div>
          <div>
            <div class="account-name">{{ user.real_name }}</div>
            <div class="account-meta">用户名：{{ user.username }}</div>
            <div class="account-meta">角色：{{ roleText }}</div>
          </div>
        </div>
      </div>

      <!-- 外观 -->
      <div class="card">
        <h3 class="card-title">外观</h3>
        <p style="font-size:13px;color:var(--ink-soft);margin-bottom:12px;">
          选择界面配色方案。跟随系统会随设备的深浅色设置自动切换。
        </p>
        <div class="radio-cards cols-3">
          <label class="radio-card" v-for="m in themePrefs" :key="m" :class="{ checked: themeMode === m }">
            <input type="radio" name="app-theme" :value="m" v-model="themeMode" @change="applyTheme">
            <span class="rc-name">{{ themeIcons[m] }}&nbsp;&nbsp;{{ themeLabels[m] }}</span>
          </label>
        </div>
        <div class="field" style="margin-top:16px;margin-bottom:0;">
          <label class="field-label">深色模式使用纯黑背景</label>
          <label class="check-card" :class="{ checked: themeOled }" style="max-width:280px;">
            <input type="checkbox" v-model="themeOled" @change="applyOled">
            <span>{{ themeOled ? '已开启' : '未开启' }}</span>
          </label>
          <p class="form-hint">开启后深色模式改用纯黑背景（含跟随系统判定为深色时），OLED 屏幕更省电并减少暗部辉光。</p>
        </div>
      </div>

      <!-- 修改密码 -->
      <div class="card" v-if="hasPassword">
        <h3 class="card-title">修改密码</h3>
        <div class="field">
          <label class="field-label">原密码<span class="req">*</span></label>
          <input class="input" type="password" v-model="pwdForm.old_password" placeholder="请输入原密码" style="max-width:400px;">
        </div>
        <div class="field">
          <label class="field-label">新密码<span class="req">*</span></label>
          <input class="input" type="password" v-model="pwdForm.new_password" placeholder="请输入新密码（至少8位）" style="max-width:400px;">
          <div class="pwd-strength" v-if="pwdForm.new_password">
            <div class="pwd-bars">
              <span class="pwd-bar" :class="{ active: pwdStrength.score >= 1, weak: pwdStrength.level === 'weak', medium: pwdStrength.level === 'medium', strong: pwdStrength.level === 'strong' }"></span>
              <span class="pwd-bar" :class="{ active: pwdStrength.score >= 3, weak: pwdStrength.level === 'weak', medium: pwdStrength.level === 'medium', strong: pwdStrength.level === 'strong' }"></span>
              <span class="pwd-bar" :class="{ active: pwdStrength.score >= 5, weak: pwdStrength.level === 'weak', medium: pwdStrength.level === 'medium', strong: pwdStrength.level === 'strong' }"></span>
            </div>
            <span class="pwd-label" :class="pwdStrength.level">{{ pwdStrength.text }}</span>
          </div>
        </div>
        <div class="field">
          <label class="field-label">确认新密码<span class="req">*</span></label>
          <input class="input" type="password" v-model="pwdForm.confirm_password" placeholder="请再次输入新密码" style="max-width:400px;">
        </div>
        <div style="margin-top:16px;">
          <button class="btn btn-primary" :disabled="pwdSubmitting" @click="submitPwdChange">
            {{ pwdSubmitting ? '提交中…' : '确认修改' }}
          </button>
        </div>
      </div>

      <!-- 登录方式 -->
      <div class="card" v-if="dingtalkEnabled">
        <h3 class="card-title">登录方式</h3>
        <div v-if="dingtalkBound" class="account-bindinfo">
          <span class="bind-status bind-ok">已绑定钉钉账号</span>
          <button class="btn btn-ghost btn-sm" @click="unbindDingtalk" :disabled="bindLoading || !hasPassword" style="margin-left:12px;">
            {{ bindLoading ? '解绑中…' : '解绑钉钉' }}
          </button>
        </div>
        <div v-else class="account-bindinfo">
          <span class="bind-status bind-none">未绑定钉钉账号，绑定后可使用钉钉快捷登录</span>
          <button class="btn btn-primary btn-sm" @click="bindDingtalk" style="margin-left:12px;">绑定钉钉</button>
        </div>
        <div v-if="dingtalkBound && hasPassword" style="margin-top:16px;padding-top:14px;border-top:1px solid var(--line);">
          <p style="font-size:13px;color:var(--ink-soft);margin-bottom:10px;">绑定钉钉后，可删除密码，之后仅通过钉钉登录。也可随时重新设置密码。</p>
          <button class="btn btn-ghost btn-sm" @click="confirmRemovePassword" style="color:var(--accent);border-color:var(--accent);">
            删除密码
          </button>
        </div>
      </div>

      <!-- 设置密码（已删除密码时显示） -->
      <div class="card" v-if="!hasPassword">
        <h3 class="card-title">设置密码</h3>
        <p style="font-size:13px;color:var(--ink-soft);margin-bottom:14px;">当前账号已删除密码，仅支持钉钉登录。您可以在此重新设置密码以恢复用户名密码登录。</p>
        <div class="field">
          <label class="field-label">新密码<span class="req">*</span></label>
          <input class="input" type="password" v-model="setPwdForm.new_password" placeholder="请输入新密码（至少8位）" style="max-width:400px;">
          <div class="pwd-strength" v-if="setPwdForm.new_password">
            <div class="pwd-bars">
              <span class="pwd-bar" :class="{ active: setPwdStrength.score >= 1, weak: setPwdStrength.level === 'weak', medium: setPwdStrength.level === 'medium', strong: setPwdStrength.level === 'strong' }"></span>
              <span class="pwd-bar" :class="{ active: setPwdStrength.score >= 3, weak: setPwdStrength.level === 'weak', medium: setPwdStrength.level === 'medium', strong: setPwdStrength.level === 'strong' }"></span>
              <span class="pwd-bar" :class="{ active: setPwdStrength.score >= 5, weak: setPwdStrength.level === 'weak', medium: setPwdStrength.level === 'medium', strong: setPwdStrength.level === 'strong' }"></span>
            </div>
            <span class="pwd-label" :class="setPwdStrength.level">{{ setPwdStrength.text }}</span>
          </div>
        </div>
        <div class="field">
          <label class="field-label">确认新密码<span class="req">*</span></label>
          <input class="input" type="password" v-model="setPwdForm.confirm_password" placeholder="请再次输入新密码" style="max-width:400px;">
        </div>
        <div style="margin-top:16px;">
          <button class="btn btn-primary" :disabled="setPwdSubmitting" @click="submitSetPassword">
            {{ setPwdSubmitting ? '设置中…' : '设置密码' }}
          </button>
        </div>
      </div>
    </div>
  </div>`,
  data: function () {
    var T = window.AppTheme;
    return {
      themeMode: T ? T.get() : 'auto',
      themeOled: T ? T.getOled() : false,
      themeResolved: T ? T.resolved() : 'light',
      themePrefs: T ? T.PREFS : ['auto', 'light', 'dark'],
      themeLabels: T ? T.LABELS : {},
      themeIcons: T ? T.ICONS : {},
      pwdForm: { old_password: '', new_password: '', confirm_password: '' },
      pwdSubmitting: false,
      setPwdForm: { new_password: '', confirm_password: '' },
      setPwdSubmitting: false,
      dingtalkEnabled: false,
      dingtalkBound: false,
      bindLoading: false,
      removingPwd: false
    };
  },
  computed: {
    user: function () { return window.AppUser; },
    hasPassword: function () {
      return this.user ? this.user.has_password !== false : true;
    },
    mustChange: function () {
      return !!(this.user && this.user.must_change_password);
    },
    avatarChar: function () {
      return this.user ? (this.user.real_name || '用').slice(0, 1) : '';
    },
    roleText: function () {
      var u = this.user;
      if (!u) return '';
      if (u.is_admin) return '管理员';
      var parts = [];
      if (u.is_teacher) parts.push('教师');
      if (u.is_leader) parts.push('专业负责人');
      return parts.join(' / ');
    },
    pwdStrength: function () {
      var pwd = this.pwdForm.new_password;
      if (!pwd) return { score: 0, level: '', text: '' };
      var score = 0;
      if (pwd.length >= 6) score++;
      if (pwd.length >= 8) score++;
      if (pwd.length >= 10) score++;
      if (/[0-9]/.test(pwd)) score++;
      if (/[a-z]/.test(pwd)) score++;
      if (/[A-Z]/.test(pwd)) score++;
      if (/[^a-zA-Z0-9]/.test(pwd)) score++;
      var level, text;
      if (score <= 2) { level = 'weak'; text = '弱'; }
      else if (score <= 4) { level = 'medium'; text = '中'; }
      else { level = 'strong'; text = '强'; }
      return { score: score, level: level, text: text };
    },
    setPwdStrength: function () {
      var pwd = this.setPwdForm.new_password;
      if (!pwd) return { score: 0, level: '', text: '' };
      var score = 0;
      if (pwd.length >= 6) score++;
      if (pwd.length >= 8) score++;
      if (pwd.length >= 10) score++;
      if (/[0-9]/.test(pwd)) score++;
      if (/[a-z]/.test(pwd)) score++;
      if (/[A-Z]/.test(pwd)) score++;
      if (/[^a-zA-Z0-9]/.test(pwd)) score++;
      var level, text;
      if (score <= 2) { level = 'weak'; text = '弱'; }
      else if (score <= 4) { level = 'medium'; text = '中'; }
      else { level = 'strong'; text = '强'; }
      return { score: score, level: level, text: text };
    }
  },
  created: function () {
    this.loadDingtalkStatus();
    var self = this;
    if (window.AppTheme) {
      this._unsubTheme = window.AppTheme.onChange(function () { self.syncTheme(); });
    }
  },
  beforeUnmount: function () {
    if (this._unsubTheme) this._unsubTheme();
  },
  methods: {
    syncTheme: function () {
      var T = window.AppTheme;
      if (!T) return;
      this.themeMode = T.get();
      this.themeOled = T.getOled();
      this.themeResolved = T.resolved();
    },
    applyTheme: function () {
      var T = window.AppTheme;
      if (!T) return;
      T.set(this.themeMode);
      this.syncTheme();
      window.toast('已切换到' + T.LABELS[this.themeMode] + '主题', 'success');
    },
    applyOled: function () {
      var T = window.AppTheme;
      if (!T) return;
      T.setOled(this.themeOled);
      this.syncTheme();
      window.toast(this.themeOled ? '已开启深色纯黑背景' : '已关闭深色纯黑背景', 'success');
    },
    submitPwdChange: async function () {
      var f = this.pwdForm;
      if (!f.old_password) { window.toast('请输入原密码', 'error'); return; }
      if (!f.new_password || f.new_password.length < 8) { window.toast('新密码长度至少8位', 'error'); return; }
      if (f.new_password !== f.confirm_password) { window.toast('两次输入的新密码不一致', 'error'); return; }
      this.pwdSubmitting = true;
      try {
        await window.API.put('/api/user/password', { old_password: f.old_password, new_password: f.new_password });
        window.toast('密码修改成功', 'success');
        this.pwdForm = { old_password: '', new_password: '', confirm_password: '' };
        if (this.user && this.user.must_change_password) {
          this.user.must_change_password = false;
          window.toast('初始密码已修改，现在可以正常使用系统了', 'success');
        }
      } catch (e) {
        window.toast(e.message || '修改失败', 'error');
      } finally {
        this.pwdSubmitting = false;
      }
    },
    loadDingtalkStatus: async function () {
      try {
        var cfg = await window.API.get('/api/auth/dingtalk/config');
        this.dingtalkEnabled = cfg.enabled;
        if (!cfg.enabled) return;
        var st = await window.API.get('/api/user/dingtalk/status');
        this.dingtalkBound = st.bound;
        if (this.user) this.user.dingtalk_bound = st.bound;
      } catch (e) { /* 忽略 */ }
    },
    bindDingtalk: function () {
      var self = this;
      window.API.get('/api/auth/dingtalk/config').then(function (cfg) {
        if (cfg.enabled && cfg.authUrl) {
          sessionStorage.setItem('dt_flow', 'bind');
          window.location.href = cfg.authUrl;
        }
      });
    },
    unbindDingtalk: async function () {
      if (!confirm('确定要解绑钉钉吗？解绑后将无法使用钉钉快捷登录。')) return;
      this.bindLoading = true;
      try {
        await window.API.post('/api/user/dingtalk/unbind');
        this.dingtalkBound = false;
        if (this.user) this.user.dingtalk_bound = false;
        window.toast('已解绑钉钉', 'success');
      } catch (e) {
        window.toast(e.message || '解绑失败', 'error');
      } finally {
        this.bindLoading = false;
      }
    },
    confirmRemovePassword: async function () {
      if (!confirm('确定要删除登录密码吗？删除后将只能通过钉钉登录。\n\n您随时可以在"我的账户"中重新设置密码。')) return;
      this.removingPwd = true;
      try {
        await window.API.post('/api/user/remove-password');
        if (this.user) this.user.has_password = false;
        window.toast('密码已删除，之后请使用钉钉登录', 'success');
      } catch (e) {
        window.toast(e.message || '操作失败', 'error');
      } finally {
        this.removingPwd = false;
      }
    },
    submitSetPassword: async function () {
      var f = this.setPwdForm;
      if (!f.new_password || f.new_password.length < 8) { window.toast('新密码长度至少8位', 'error'); return; }
      if (f.new_password !== f.confirm_password) { window.toast('两次输入的新密码不一致', 'error'); return; }
      this.setPwdSubmitting = true;
      try {
        await window.API.post('/api/user/set-password', { new_password: f.new_password });
        window.toast('密码设置成功，现在可以使用用户名密码登录了', 'success');
        if (this.user) this.user.has_password = true;
        this.setPwdForm = { new_password: '', confirm_password: '' };
      } catch (e) {
        window.toast(e.message || '设置失败', 'error');
      } finally {
        this.setPwdSubmitting = false;
      }
    }
  }
};
