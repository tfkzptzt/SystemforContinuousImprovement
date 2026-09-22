/* ============================================================
 * views/dingtalk-callback.js —— 钉钉 OAuth 回调处理
 * 钉钉授权后重定向到此页面，根据 flow 分别处理登录 / 绑定
 * ============================================================ */
window.VIEWS.DingtalkCallback = {
  name: 'DingtalkCallback',
  template: `
  <div class="login-wrap">
    <main class="login-panel" style="display:flex;align-items:center;justify-content:center;min-height:60vh;">
      <div class="login-box" style="text-align:center;" v-if="!showBindForm">
        <div class="dt-loading">
          <div class="dt-spinner"></div>
          <p style="margin-top:18px;color:var(--ink-light);">{{ loadingText }}</p>
        </div>
      </div>

      <div class="login-box" v-if="showBindForm">
        <h2>绑定账号</h2>
        <p class="sub">钉钉账号 {{ dtNick }} 尚未绑定，请输入系统用户名和密码完成绑定</p>
        <form @submit.prevent="doBindLogin">
          <div class="field">
            <label class="field-label">用户名<span class="req">*</span></label>
            <input class="input" v-model.trim="username" placeholder="请输入用户名" autocomplete="username">
          </div>
          <div class="field">
            <label class="field-label">密码<span class="req">*</span></label>
            <input class="input" type="password" v-model="password" placeholder="请输入密码" autocomplete="current-password">
          </div>
          <button class="btn btn-primary btn-block" type="submit" :disabled="binding"
                  style="margin-top:8px;padding:11px;">
            {{ binding ? '绑定中…' : '绑定并登录' }}
          </button>
        </form>
        <p style="margin-top:16px;text-align:center;">
          <button class="btn-link" @click="backToLogin">返回登录页</button>
        </p>
      </div>
    </main>
  </div>`,
  data: function () {
    return {
      loadingText: '正在通过钉钉授权登录…',
      showBindForm: false,
      dtNick: '',
      username: '',
      password: '',
      binding: false
    };
  },
  created: function () {
    this.handleCallback();
  },
  methods: {
    async handleCallback() {
      var params = new URLSearchParams(window.location.search);
      var authCode = params.get('authCode');
      if (!authCode) {
        window.toast('钉钉授权失败：未获取到授权码', 'error');
        this.$router.push('/login');
        return;
      }

      var flow = sessionStorage.getItem('dt_flow') || 'login';
      sessionStorage.removeItem('dt_flow');

      try {
        var result = await window.API.post('/api/auth/dingtalk/callback', {
          authCode: authCode,
          flow: flow
        });

        if (flow === 'bind') {
          window.toast('钉钉绑定成功', 'success');
          this.$router.push('/account');
          return;
        }

        if (result.bound && result.user) {
          window.AppUser = result.user;
          window.resetAuthCache();
          window.toast('钉钉登录成功', 'success');
          if (result.user.is_admin) {
            this.$router.push('/admin/users');
          } else {
            this.$router.push('/');
          }
        } else {
          this.dtNick = result.nick || '';
          this.showBindForm = true;
          this.loadingText = '';
        }
      } catch (e) {
        window.toast(e.message || '钉钉授权失败', 'error');
        this.$router.push('/login');
      }
    },
    async doBindLogin() {
      if (!this.username || !this.password) {
        window.toast('请输入用户名和密码', 'error');
        return;
      }
      this.binding = true;
      try {
        var user = await window.API.post('/api/auth/dingtalk/bind-login', {
          username: this.username,
          password: this.password
        });
        window.AppUser = user;
        window.resetAuthCache();
        window.toast('绑定成功，已登录', 'success');
        this.$router.push('/');
      } catch (e) {
        window.toast(e.message || '绑定失败', 'error');
      } finally {
        this.binding = false;
      }
    },
    backToLogin() {
      this.$router.push('/login');
    }
  }
};
