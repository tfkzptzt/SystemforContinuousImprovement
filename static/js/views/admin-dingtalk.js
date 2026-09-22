/* ============================================================
 * views/admin-dingtalk.js —— 管理后台 · 钉钉登录配置
 * AppKey / AppSecret / RedirectURI
 * ============================================================ */
window.VIEWS.AdminDingtalk = {
  name: 'AdminDingtalk',
  template: `
  <div class="page" style="max-width:780px;">
    <div class="page-head">
      <div>
        <h1 class="page-title">钉钉登录配置</h1>
        <p class="page-sub">配置钉钉应用信息，启用后用户可使用钉钉快捷登录</p>
      </div>
    </div>

    <div v-if="loading" class="loading">正在加载配置</div>

    <template v-else>
      <div class="notice notice-blue" style="margin-bottom:18px;">
        <span class="n-ico">ℹ</span>
        <div>
          需要在钉钉开放平台创建企业内部应用，获取 AppKey 和 AppSecret。<br>
          回调地址需填写为当前系统的访问地址（如 <code>https://your-domain.com/#/dingtalk-callback</code>）。<br>
          未在此处配置时，系统将使用服务器环境变量（DINGTALK_APP_KEY / DINGTALK_APP_SECRET / DINGTALK_REDIRECT_URI）。
        </div>
      </div>

      <div class="card">
        <h3 class="card-title"><span><span class="idx">壹</span>钉钉应用配置</span></h3>

        <div class="field">
          <label class="field-label">AppKey（Client ID）</label>
          <input class="input" v-model.trim="form.app_key" placeholder="请输入钉钉应用 AppKey">
          <p class="form-hint" v-if="effectiveSource.app_key">
            当前生效来源：<b>{{ sourceLabel(effectiveSource.app_key) }}</b>
          </p>
        </div>

        <div class="field">
          <label class="field-label">AppSecret（Client Secret）</label>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
            <input class="input" type="password" v-model="form.app_secret"
                   :placeholder="config.app_secret_set ? '****** 已配置' : '请输入 AppSecret'"
                   style="flex:1;min-width:200px;">
            <span class="badge badge-green" v-if="config.app_secret_set">已配置</span>
            <button class="btn btn-ghost btn-sm" v-if="config.app_secret_set"
                    @click="clearSecret" :disabled="saving">清除密钥</button>
          </div>
          <p class="form-hint">留空表示不修改当前密钥。密钥仅写入不读出，保存后显示为掩码。</p>
          <p class="form-hint" v-if="effectiveSource.app_secret">
            当前生效来源：<b>{{ sourceLabel(effectiveSource.app_secret) }}</b>
          </p>
        </div>

        <div class="field">
          <label class="field-label">回调地址（Redirect URI）</label>
          <input class="input" v-model.trim="form.redirect_uri" placeholder="https://your-domain.com/#/dingtalk-callback">
          <p class="form-hint">钉钉授权完成后的回调地址，需与钉钉开放平台配置一致。</p>
          <p class="form-hint" v-if="effectiveSource.redirect_uri">
            当前生效来源：<b>{{ sourceLabel(effectiveSource.redirect_uri) }}</b>
          </p>
        </div>
      </div>

      <div class="card" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
        <button class="btn btn-primary" @click="save" :disabled="saving" style="padding:8px 28px;">
          {{ saving ? '保存中…' : '保存配置' }}
        </button>
        <span v-if="saveMsg" class="notice notice-green" style="flex:1;min-width:200px;margin:0;">
          <span class="n-ico">✓</span> {{ saveMsg }}
        </span>
      </div>

      <div class="card">
        <h3 class="card-title"><span><span class="idx">贰</span>配置说明</span></h3>
        <div style="font-size:13px;color:var(--ink-soft);line-height:1.8;">
          <p><b>1. 创建钉钉应用</b></p>
          <p style="margin-left:1em;">登录 <a href="https://open-dev.dingtalk.com/" target="_blank" style="color:var(--primary);">钉钉开放平台</a> → 应用开发 → 企业内部开发 → 创建应用。</p>
          <p><b>2. 配置权限</b></p>
          <p style="margin-left:1em;">在应用的「权限管理」中申请：<code>Contact.User.Read</code>（通讯录用户信息读权限）。</p>
          <p><b>3. 配置回调地址</b></p>
          <p style="margin-left:1em;">在「登录与分享」中添加上述回调地址。</p>
          <p><b>4. 获取凭证</b></p>
          <p style="margin-left:1em;">在「凭证与基础信息」中获取 AppKey 和 AppSecret，填入上方保存即可。</p>
        </div>
      </div>
    </template>
  </div>`,
  data: function () {
    return {
      loading: true,
      saving: false,
      config: {},
      effectiveSource: {},
      form: {
        app_key: '',
        app_secret: '',
        redirect_uri: ''
      },
      saveMsg: ''
    };
  },
  created: function () { this.load(); },
  methods: {
    sourceLabel: function (src) {
      if (src === 'db') return '数据库配置';
      if (src === 'env') return '环境变量';
      return '未配置';
    },
    async load() {
      this.loading = true;
      try {
        var data = await window.API.get('/api/admin/dingtalk-config');
        this.config = data;
        this.effectiveSource = data.effective_source || {};
        this.form.app_key = data.app_key || '';
        this.form.app_secret = '';
        this.form.redirect_uri = data.redirect_uri || '';
      } catch (e) {
        window.toast(e.message, 'error');
      } finally {
        this.loading = false;
      }
    },
    async save() {
      var payload = {
        app_key: this.form.app_key,
        redirect_uri: this.form.redirect_uri
      };
      if (this.form.app_secret) payload.app_secret = this.form.app_secret;
      this.saving = true;
      this.saveMsg = '';
      try {
        var data = await window.API.put('/api/admin/dingtalk-config', payload);
        this.config = data;
        this.effectiveSource = data.effective_source || {};
        this.form.app_secret = '';
        this.saveMsg = '配置已保存';
        window.toast('钉钉配置已保存', 'success');
        var self = this;
        setTimeout(function () { self.saveMsg = ''; }, 3000);
      } catch (e) {
        window.toast(e.message, 'error');
      } finally {
        this.saving = false;
      }
    },
    async clearSecret() {
      if (!confirm('确认清除已保存的 AppSecret？清除后系统将回落使用环境变量（若未设置则钉钉登录不可用）。')) return;
      this.saving = true;
      this.saveMsg = '';
      try {
        var payload = {
          app_key: this.form.app_key,
          redirect_uri: this.form.redirect_uri,
          clear_app_secret: true
        };
        var data = await window.API.put('/api/admin/dingtalk-config', payload);
        this.config = data;
        this.effectiveSource = data.effective_source || {};
        this.form.app_secret = '';
        this.saveMsg = 'AppSecret 已清除';
        window.toast('AppSecret 已清除', 'success');
        var self = this;
        setTimeout(function () { self.saveMsg = ''; }, 3000);
      } catch (e) {
        window.toast(e.message, 'error');
      } finally {
        this.saving = false;
      }
    }
  }
};
