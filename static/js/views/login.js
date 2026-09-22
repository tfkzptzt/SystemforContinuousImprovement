/* ============================================================
 * views/login.js —— 登录页（用户名/密码 + 登录成功后的端口入口选择）
 * ============================================================ */
window.VIEWS.Login = {
  name: 'LoginView',
  template: `
  <div class="login-wrap">
    <button class="theme-toggle login-theme-fab" @click="cycleTheme"
            :title="'主题：' + themeLabel" :aria-label="'切换主题，当前' + themeLabel">
      {{ themeIcon }}
    </button>
    <aside class="login-hero">
      <div class="hero-seal">
        <img class="brand-logo brand-logo-lg" src="/static/img/logo.png" alt="应急管理大学校徽">
        <span>高校课程持续改进系统</span>
      </div>
      <div>
        <h1 class="hero-title">以评促改<br><em>闭环追溯</em> 持续精进</h1>
        <p class="hero-desc">
          面向课程考核报告的持续改进流程平台：从问题剖析、措施生成、
          责任指派到达成验证与四级定级，全程留痕、可追可溯。
        </p>
      </div>
      <ul class="hero-steps">
        <li><span class="step-no">1</span>教师上传课程考核报告，系统智能生成改进措施</li>
        <li><span class="step-no">2</span>专业负责人审批措施并指派责任人、设定截止时间</li>
        <li><span class="step-no">3</span>教师按期执行并提交达成情况，负责人定级归档</li>
      </ul>
    </aside>

    <main class="login-panel">
      <div class="login-box" v-if="!loggedUser">
        <h2>欢迎登录</h2>
        <p class="sub">Continuous Improvement Platform · 请使用工号登录</p>
        <form @submit.prevent="doLogin">
          <div class="field">
            <label class="field-label">用户名<span class="req">*</span></label>
            <input class="input" v-model.trim="username" placeholder="请输入用户名" autocomplete="username">
          </div>
          <div class="field">
            <label class="field-label">密码<span class="req">*</span></label>
            <input class="input" type="password" v-model="password" placeholder="请输入密码" autocomplete="current-password">
          </div>
          <button class="btn btn-primary btn-block" type="submit" :disabled="loading"
                  style="margin-top:8px;padding:11px;">
            {{ loading ? '正在登录…' : '登 录' }}
          </button>
        </form>
        <div class="dt-divider" v-if="dingtalkEnabled">
          <span>或</span>
        </div>
        <button class="btn btn-block dt-login-btn" v-if="dingtalkEnabled" @click="goDingtalk"
                style="margin-top:0;">
          <svg class="dt-icon" viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.568 14.845l-.22.34c-.2.3-.56.51-.93.56l-.14.01h-2.6l-.58 1.1c-.18.34-.53.56-.91.58a1.07 1.07 0 0 1-.87-.38l-2.1-2.53-3.1.83a.49.49 0 0 1-.55-.22.49.49 0 0 1 .1-.6l3.6-3.66-.02-.03.3-.47c.15-.24.44-.37.72-.32l4.82.86 2.16-.83a.38.38 0 0 1 .44.1.38.38 0 0 1-.05.48l-1.07 1.1.53 2.28z"/></svg>
          钉钉登录
        </button>
      </div>

      <div class="login-box" v-else>
        <h2>登录成功</h2>
        <p class="sub" v-if="loggedUser.is_admin">{{ loggedUser.real_name }}，您好！正在进入管理后台…</p>
        <p class="sub" v-else>{{ loggedUser.real_name }}，您好！请选择要进入的工作端</p>
        <div class="entry-cards" v-if="!loggedUser.is_admin">
          <div class="entry-card" :class="{ locked: !loggedUser.is_teacher }"
               @click="enter('teacher')">
            <span class="e-ico">📚</span>
            <div class="e-name">教师端</div>
            <div class="e-desc">上传报告 · 编辑措施 · 提交达成情况</div>
            <span class="e-lock" v-if="!loggedUser.is_teacher">仅教师账号可用</span>
          </div>
          <div class="entry-card" :class="{ locked: !loggedUser.is_leader }"
               @click="enter('leader')">
            <span class="e-ico">🖋️</span>
            <div class="e-name">专业负责人端</div>
            <div class="e-desc">审批措施 · 定级归档 · 批量导入</div>
            <span class="e-lock" v-if="!loggedUser.is_leader">仅负责人账号可用</span>
          </div>
        </div>
        <p style="margin-top:22px;text-align:center;">
          <button class="btn-link" @click="switchAccount">切换账号</button>
        </p>
      </div>
    </main>
  </div>`,
  data: function () {
    return {
      username: '',
      password: '',
      loading: false,
      loggedUser: null,
      dingtalkEnabled: false,
      dingtalkAuthUrl: '',
      themeMode: window.AppTheme ? window.AppTheme.get() : 'auto',
      themeOled: window.AppTheme ? window.AppTheme.getOled() : false,
      themeResolved: window.AppTheme ? window.AppTheme.resolved() : 'light'
    };
  },
  computed: {
    themeLabel: function () {
      var T = window.AppTheme;
      return T ? T.labelOf(this.themeMode, this.themeOled, this.themeResolved) : '';
    },
    themeIcon: function () {
      var T = window.AppTheme;
      return T ? T.iconOf(this.themeMode, this.themeOled, this.themeResolved) : '◐';
    }
  },
  created: function () {
    var self = this;
    if (window.AppTheme) {
      this._unsubTheme = window.AppTheme.onChange(function () { self.syncTheme(); });
    }
    this.loadDingtalkConfig();
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
    cycleTheme: function () {
      var T = window.AppTheme;
      if (!T) return;
      T.next();
      this.syncTheme();
      window.toast('主题：' + T.label(), 'info');
    },
    async loadDingtalkConfig() {
      try {
        var cfg = await window.API.get('/api/auth/dingtalk/config');
        if (cfg.enabled) {
          this.dingtalkEnabled = true;
          this.dingtalkAuthUrl = cfg.authUrl;
        }
      } catch (e) { /* 忽略 */ }
    },
    goDingtalk() {
      if (this.dingtalkAuthUrl) {
        sessionStorage.setItem('dt_flow', 'login');
        window.location.href = this.dingtalkAuthUrl;
      }
    },
    async doLogin() {
      if (!this.username || !this.password) {
        window.toast('请输入用户名和密码', 'error');
        return;
      }
      this.loading = true;
      try {
        var user = await window.API.post('/api/auth/login', {
          username: this.username,
          password: this.password
        });
        window.AppUser = user;
        this.loggedUser = user;
        window.toast('登录成功', 'success');
        if (user && user.is_admin) {
          this.$router.push('/admin/users');
          return;
        }
      } catch (e) {
        window.toast(e.message, 'error');
      } finally {
        this.loading = false;
      }
    },
    enter(role) {
      var ok = role === 'teacher' ? this.loggedUser.is_teacher : this.loggedUser.is_leader;
      if (!ok) {
        window.toast(role === 'teacher'
          ? '当前账号无教师端权限，无法进入'
          : '当前账号无专业负责人端权限，无法进入', 'error');
        return;
      }
      this.$router.push(role === 'teacher' ? '/teacher/dashboard' : '/leader/dashboard');
    },
    async switchAccount() {
      try { await window.API.post('/api/auth/logout'); } catch (e) { /* 忽略 */ }
      window.AppUser = null;
      if (window.resetAuthCache) window.resetAuthCache();
      this.loggedUser = null;
      this.username = '';
      this.password = '';
    }
  }
};
