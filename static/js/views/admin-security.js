/* ============================================================
 * views/admin-security.js —— 管理后台 · 安全选项
 * 首次登录强制改密开关 / 登录失败锁定（最大尝试次数 + 锁定时长）
 * ============================================================ */
window.VIEWS.AdminSecurity = {
  name: 'AdminSecurity',
  template: `
  <div class="page" style="max-width:780px;">
    <div class="page-head">
      <div>
        <h1 class="page-title">安全选项</h1>
        <p class="page-sub">配置登录密码策略与失败锁定，降低弱口令与暴力破解风险</p>
      </div>
    </div>

    <div v-if="loading" class="loading">正在加载配置</div>

    <template v-else>
      <div class="notice notice-blue" style="margin-bottom:18px;">
        <span class="n-ico">ℹ</span>
        <div>
          新建用户与重置密码都会生成随机初始密码；开启「首次登录强制修改」后，
          用户使用初始密码登录后必须先改密才能访问其它功能。密码最短长度为 {{ cfg.min_password_len }} 位。
        </div>
      </div>

      <div class="card">
        <h3 class="card-title"><span><span class="idx">壹</span>密码策略</span></h3>

        <div class="field">
          <label class="field-label">首次登录强制修改初始密码</label>
          <label class="check-card" :class="{ checked: form.force_pwd_change }" style="max-width:280px;">
            <input type="checkbox" v-model="form.force_pwd_change">
            <span>{{ form.force_pwd_change ? '已开启' : '未开启' }}</span>
          </label>
          <p class="form-hint">开启后，持有随机初始密码（新建或重置）的用户首次登录会被强制跳转到「我的账户」修改密码。</p>
        </div>

        <div class="field" style="margin-bottom:0;">
          <label class="field-label">密码最短长度</label>
          <div style="font-size:15px;color:var(--ink);">{{ cfg.min_password_len }} 位</div>
          <p class="form-hint">全局固定值，新建用户、导入、重置及用户自行改密均适用。</p>
        </div>
      </div>

      <div class="card">
        <h3 class="card-title"><span><span class="idx">贰</span>登录失败锁定</span></h3>

        <div class="form-row">
          <div class="field">
            <label class="field-label">最大尝试次数</label>
            <input class="input" type="number" v-model.number="form.login_max_attempts"
                   :min="cfg.attempts_range[0]" :max="cfg.attempts_range[1]" step="1" style="max-width:160px;">
            <p class="form-hint">同一 IP + 用户名在锁定时长内允许的登录尝试次数，范围 {{ cfg.attempts_range[0] }}-{{ cfg.attempts_range[1] }}。</p>
          </div>
          <div class="field">
            <label class="field-label">锁定时长（分钟）</label>
            <input class="input" type="number" v-model.number="form.login_lock_minutes"
                   :min="cfg.lock_range[0]" :max="cfg.lock_range[1]" step="1" style="max-width:160px;">
            <p class="form-hint">超过最大尝试次数后临时封锁的时长，范围 {{ cfg.lock_range[0] }}-{{ cfg.lock_range[1] }} 分钟。</p>
          </div>
        </div>
      </div>

      <div class="card" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
        <button class="btn btn-primary" @click="save" :disabled="saving" style="padding:8px 28px;">
          {{ saving ? '保存中…' : '保存配置' }}
        </button>
        <span v-if="savedTip" class="notice notice-green" style="flex:1;min-width:200px;margin:0;">
          <span class="n-ico">✓</span>{{ savedTip }}
        </span>
      </div>
    </template>
  </div>`,
  data: function () {
    return {
      loading: true,
      saving: false,
      cfg: { min_password_len: 8, attempts_range: [3, 100], lock_range: [1, 1440] },
      form: { force_pwd_change: true, login_max_attempts: 10, login_lock_minutes: 15 },
      savedTip: ''
    };
  },
  created: function () { this.load(); },
  methods: {
    async load() {
      this.loading = true;
      try {
        var data = await window.API.get('/api/admin/security-config');
        this.cfg = data;
        this.form.force_pwd_change = !!data.force_pwd_change;
        this.form.login_max_attempts = data.login_max_attempts;
        this.form.login_lock_minutes = data.login_lock_minutes;
      } catch (e) {
        window.toast(e.message, 'error');
      } finally {
        this.loading = false;
      }
    },
    async save() {
      var r = this.cfg;
      var a = this.form.login_max_attempts;
      var m = this.form.login_lock_minutes;
      if (!Number.isInteger(a) || a < r.attempts_range[0] || a > r.attempts_range[1]) {
        window.toast('最大尝试次数必须在 ' + r.attempts_range[0] + '-' + r.attempts_range[1] + ' 之间', 'error');
        return;
      }
      if (!Number.isInteger(m) || m < r.lock_range[0] || m > r.lock_range[1]) {
        window.toast('锁定时长必须在 ' + r.lock_range[0] + '-' + r.lock_range[1] + ' 分钟之间', 'error');
        return;
      }
      this.saving = true;
      this.savedTip = '';
      try {
        var data = await window.API.put('/api/admin/security-config', {
          force_pwd_change: this.form.force_pwd_change,
          login_max_attempts: a,
          login_lock_minutes: m
        });
        this.cfg = data;
        this.form.force_pwd_change = !!data.force_pwd_change;
        this.form.login_max_attempts = data.login_max_attempts;
        this.form.login_lock_minutes = data.login_lock_minutes;
        this.savedTip = '安全选项已保存';
        window.toast('安全选项已保存', 'success');
      } catch (e) {
        window.toast(e.message, 'error');
      } finally {
        this.saving = false;
      }
    }
  }
};
