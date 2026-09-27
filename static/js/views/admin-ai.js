/* ============================================================
 * views/admin-ai.js —— 管理后台 · AI 大模型配置
 * 启用开关 / API Key / Base URL / 模型 / 超时 / 系统提示词 / 测试连接
 * ============================================================ */
window.VIEWS.AdminAi = {
  name: 'AdminAi',
  template: `
  <div class="page" style="max-width:780px;">
    <div class="page-head">
      <div>
        <h1 class="page-title">AI 配置</h1>
        <p class="page-sub">配置大模型接口，用于自动生成改进措施</p>
      </div>
    </div>

    <div v-if="loading" class="loading">正在加载配置</div>

    <template v-else>
      <!-- 说明提示 -->
      <div class="notice notice-blue" style="margin-bottom:18px;">
        <span class="n-ico">ℹ</span>
        <div>
          未在此处配置时，系统将使用服务器环境变量（AI_API_KEY / AI_BASE_URL / AI_MODEL / AI_TIMEOUT）。<br>
          AI 调用失败时自动回退内置规则引擎，不影响正常业务流程。
        </div>
      </div>

      <!-- 配置表单 -->
      <div class="card">
        <h3 class="card-title"><span><span class="idx">壹</span>基本设置</span></h3>

        <div class="field">
          <label class="field-label">启用 AI 生成</label>
          <label class="check-card" :class="{ checked: form.enabled }" style="max-width:280px;">
            <input type="checkbox" v-model="form.enabled">
            <span>{{ form.enabled ? '已启用' : '未启用' }}</span>
          </label>
          <p class="form-hint">关闭后生成措施将直接使用内置规则引擎。</p>
        </div>

        <div class="field">
          <label class="field-label">API Key</label>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
            <input class="input" type="password" v-model="form.api_key"
                   :placeholder="config.api_key_set ? (config.api_key_masked + ' 已配置') : '请输入 API Key'"
                   style="flex:1;min-width:200px;">
            <span class="badge badge-green" v-if="config.api_key_set">已配置</span>
            <button class="btn btn-ghost btn-sm" v-if="config.api_key_set"
                    @click="clearKey" :disabled="saving">清除密钥</button>
          </div>
          <p class="form-hint">留空表示不修改当前密钥。密钥仅写入不读出，保存后显示为掩码。</p>
          <p class="form-hint" v-if="effectiveSource.api_key">
            当前生效来源：<b>{{ sourceLabel(effectiveSource.api_key) }}</b>
          </p>
        </div>

        <div class="form-row">
          <div class="field">
            <label class="field-label">Base URL</label>
            <input class="input" v-model.trim="form.base_url"
                   placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1">
          </div>
          <div class="field">
            <label class="field-label">模型</label>
            <input class="input" v-model.trim="form.model" placeholder="qwen-plus">
          </div>
        </div>

        <div class="field">
          <label class="field-label">超时（秒）</label>
          <input class="input" type="number" v-model.number="form.timeout"
                 min="1" max="120" step="1" style="max-width:140px;">
          <p class="form-hint">单次 AI 请求超时时间。默认提示词要求每条措施含问题引用、具体做法与验证口径，生成较慢，建议 60-90 秒；该值须小于 gunicorn 的 --timeout 与 Nginx 的 proxy_read_timeout，否则请求会被上游先掐断。</p>
        </div>
      </div>

      <div class="card">
        <h3 class="card-title">
          <span><span class="idx">贰</span>系统提示词</span>
          <button class="btn btn-ghost btn-sm" @click="resetPrompt">恢复默认</button>
        </h3>
        <div class="field" style="margin-bottom:0;">
          <textarea class="textarea" v-model="form.prompt" rows="8"
                    placeholder="用于指导 AI 生成改进措施的系统提示词。留空则使用后端内置默认提示词。"></textarea>
          <p class="form-hint">提示词应描述生成改进措施的角色、格式与约束。留空时后端使用默认值。</p>
          <p class="form-hint" v-if="effectiveSource.prompt">
            提示词生效来源：<b>{{ effectiveSource.prompt === 'db' ? '数据库配置' : '内置默认' }}</b>
          </p>
        </div>
      </div>

      <!-- 操作按钮 -->
      <div class="card" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
        <button class="btn btn-primary" @click="save" :disabled="saving" style="padding:8px 28px;">
          {{ saving ? '保存中…' : '保存配置' }}
        </button>
        <button class="btn btn-accent" @click="testConnection" :disabled="testing" style="padding:8px 28px;">
          {{ testing ? '测试中…' : '测试连接' }}
        </button>
        <span v-if="testResult" :class="testResult.ok ? 'notice notice-green' : 'notice notice-red'"
              style="flex:1;min-width:200px;margin:0;">
          <span class="n-ico">{{ testResult.ok ? '✓' : '✕' }}</span>
          {{ testResult.msg }}
        </span>
      </div>
    </template>
  </div>`,
  data: function () {
    return {
      loading: true,
      saving: false,
      testing: false,
      config: {},
      effectiveSource: {},
      form: {
        enabled: false,
        api_key: '',
        base_url: '',
        model: '',
        timeout: 60,
        prompt: ''
      },
      testResult: null
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
        var data = await window.API.get('/api/admin/ai-config');
        this.config = data;
        this.effectiveSource = data.effective_source || {};
        this.form.enabled = !!data.enabled;
        this.form.api_key = '';
        this.form.base_url = data.base_url || '';
        this.form.model = data.model || '';
        this.form.timeout = data.timeout || 60;
        this.form.prompt = data.prompt || '';
      } catch (e) {
        window.toast(e.message, 'error');
      } finally {
        this.loading = false;
      }
    },
    async save() {
      var payload = {
        enabled: this.form.enabled,
        base_url: this.form.base_url,
        model: this.form.model,
        timeout: this.form.timeout,
        prompt: this.form.prompt
      };
      if (this.form.api_key) payload.api_key = this.form.api_key;
      this.saving = true;
      try {
        var data = await window.API.put('/api/admin/ai-config', payload);
        this.config = data;
        this.effectiveSource = data.effective_source || {};
        this.form.api_key = '';
        this.testResult = null;
        window.toast('配置已保存', 'success');
      } catch (e) {
        window.toast(e.message, 'error');
      } finally {
        this.saving = false;
      }
    },
    async clearKey() {
      if (!confirm('确认清除已保存的 API Key？清除后系统将回落使用环境变量（若未设置则 AI 功能不可用，自动走规则引擎）。')) return;
      this.saving = true;
      try {
        var payload = {
          enabled: this.form.enabled,
          base_url: this.form.base_url,
          model: this.form.model,
          timeout: this.form.timeout,
          prompt: this.form.prompt,
          clear_api_key: true
        };
        var data = await window.API.put('/api/admin/ai-config', payload);
        this.config = data;
        this.effectiveSource = data.effective_source || {};
        this.form.api_key = '';
        this.testResult = null;
        window.toast('API Key 已清除', 'success');
      } catch (e) {
        window.toast(e.message, 'error');
      } finally {
        this.saving = false;
      }
    },
    resetPrompt() {
      if (this.config.default_prompt) {
        this.form.prompt = this.config.default_prompt;
        window.toast('已回填后端默认提示词，请点击「保存配置」生效', 'info');
      } else {
        this.form.prompt = '';
        window.toast('已清空提示词，保存后将使用后端默认值', 'info');
      }
    },
    async testConnection() {
      this.testing = true;
      this.testResult = null;
      try {
        var data = await window.API.post('/api/admin/ai-config/test');
        this.testResult = { ok: true, msg: data.message + (data.model ? '（模型：' + data.model + '）' : '') };
      } catch (e) {
        this.testResult = { ok: false, msg: e.message };
      } finally {
        this.testing = false;
      }
    }
  }
};
