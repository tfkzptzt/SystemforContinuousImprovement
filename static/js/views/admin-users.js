/* ============================================================
 * views/admin-users.js —— 管理后台 · 用户管理
 * 用户列表 / 新建 / 角色编辑 / 重置密码 / 停用启用 / 双重确认删除
 * ============================================================ */
window.VIEWS.AdminUsers = {
  name: 'AdminUsers',
  template: `
  <div class="page">
    <div class="page-head">
      <div>
        <h1 class="page-title">用户管理</h1>
        <p class="page-sub">管理系统账号、工作端角色与停用状态，<a style="color:var(--ink);">重置或删除账号需谨慎操作</a></p>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-outline" @click="openImport">导入用户</button>
        <button class="btn btn-primary" @click="openCreate">＋ 新建用户</button>
      </div>
    </div>

    <div class="card tight">
      <div v-if="loading" class="loading">正在加载用户列表</div>
      <div v-else-if="!users.length" class="empty">
        <span class="e-mark">◇</span>暂无用户数据
      </div>
      <div class="table-wrap" v-else>
        <table class="tbl">
          <thead>
            <tr>
              <th>用户名</th>
              <th>姓名</th>
              <th>工作端</th>
              <th>状态</th>
              <th style="text-align:right;">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in users" :key="u.id" :class="{ 'row-disabled': u.is_disabled }">
              <td class="cell-strong">{{ u.username }}</td>
              <td>{{ u.real_name }}</td>
              <td>
                <span class="badge badge-blue" v-if="u.is_teacher">教师端</span>
                <span class="badge badge-teal" v-if="u.is_leader" style="margin-left:4px;">负责人端</span>
                <span class="badge badge-ink" v-if="u.is_admin" style="margin-left:4px;">管理员</span>
              </td>
              <td>
                <span class="badge badge-green" v-if="!u.is_disabled">正常</span>
                <span class="badge badge-gray" v-else>停用</span>
                <span class="badge badge-blue" v-if="dingtalkEnabled && u.dingtalk_bound" style="margin-left:4px;">钉钉</span>
              </td>
              <td>
                <div class="row-actions" style="justify-content:flex-end;">
                  <button class="btn btn-ghost btn-sm" @click="openRoles(u)">角色</button>
                  <button class="btn btn-ghost btn-sm" @click="askReset(u)">重置密码</button>
                  <button class="btn btn-ghost btn-sm" @click="toggleDisabled(u)">
                    {{ u.is_disabled ? '启用' : '停用' }}
                  </button>
                  <button class="btn btn-ghost btn-sm" v-if="dingtalkEnabled && u.dingtalk_bound" @click="openUnbindDt(u)">解绑钉钉</button>
                  <button class="btn btn-danger btn-sm" @click="openDelete(u)">删除</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 导入用户弹窗 -->
    <div class="modal-mask" v-if="importOpen" @click.self="importOpen = false">
      <div class="modal" style="width:640px;">
        <h3 class="modal-title">批量导入用户</h3>
        <p class="form-hint">上传 Excel (.xlsx) 或 CSV 文件，表头包含：用户名、姓名、角色、密码（留空自动生成随机密码）</p>
        <p class="form-hint">角色可填：教师 / 负责人 / 管理员，多角色用逗号分隔（如"教师，负责人"）；密码留空时系统生成随机初始密码，导入完成后可下载对照表。</p>

        <!-- 步骤1：上传文件 -->
        <template v-if="importStep === 'upload'">
          <div class="field">
            <label class="field-label">下载模板</label>
            <a class="btn btn-ghost btn-sm" href="/api/admin/users/import/template" download>下载导入模板.xlsx</a>
          </div>
          <div class="field">
            <label class="field-label">选择文件<span class="req">*</span></label>
            <input class="input" type="file" ref="importFile" accept=".xlsx,.xlsm,.csv" @change="onImportFile">
          </div>
          <div class="modal-foot">
            <button class="btn btn-ghost" @click="importOpen = false">关闭</button>
            <button class="btn btn-primary" @click="doPreview" :disabled="importing || !importFile">
              {{ importing ? '正在解析…' : '下一步：预览' }}
            </button>
          </div>
        </template>

        <!-- 步骤2：预览确认 -->
        <template v-if="importStep === 'preview'">
          <div style="margin-bottom:12px;">
            <span class="badge badge-green" v-if="previewData.success_count">可导入 {{ previewData.success_count }} 人</span>
            <span class="badge badge-red" v-if="previewData.failed_count" style="margin-left:6px;">失败 {{ previewData.failed_count }} 人</span>
          </div>
          <div class="table-wrap" style="max-height:320px;overflow:auto;margin-bottom:12px;" v-if="previewData.preview_rows && previewData.preview_rows.length">
            <table class="tbl">
              <thead><tr><th>行</th><th>用户名</th><th>姓名</th><th>角色</th></tr></thead>
              <tbody>
                <tr v-for="r in previewData.preview_rows" :key="r.row">
                  <td>{{ r.row }}</td><td class="cell-strong">{{ r.username }}</td><td>{{ r.real_name }}</td><td>{{ r.role }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-if="previewData.failed_rows && previewData.failed_rows.length" style="margin-bottom:12px;font-size:13px;color:var(--red);max-height:120px;overflow:auto;">
            <div v-for="f in previewData.failed_rows" :key="f.row">第{{ f.row }}行：{{ f.error }}</div>
          </div>
          <div class="modal-foot">
            <button class="btn btn-ghost" @click="importStep = 'upload'; previewData = null">上一步</button>
            <button class="btn btn-primary" @click="doConfirmImport" :disabled="importing || !previewData.success_count">
              {{ importing ? '正在导入…' : '确认导入' }}
            </button>
          </div>
        </template>

        <!-- 步骤3：导入完成，下载凭据 -->
        <template v-if="importStep === 'done'">
          <div class="notice notice-green" style="margin-bottom:14px;">
            <span class="n-ico">✓</span>
            <div>导入完成，成功 {{ doneData.success_count }} 人<span v-if="doneData.failed_count">，失败 {{ doneData.failed_count }} 人</span>。</div>
          </div>
          <div v-if="doneData.credentials_bundle" class="field">
            <label class="field-label">下载用户名 / 初始密码对照表</label>
            <p class="form-hint" style="margin-bottom:10px;">
              对照表内含本次导入用户的初始密码，<b>仅本次有效且限时下载</b>，请立即下载并通过安全渠道分发。
            </p>
            <a class="btn btn-primary btn-sm" :href="credentialsUrl" download>下载初始密码表.xlsx</a>
          </div>
          <div v-else class="notice notice-blue" style="margin-bottom:14px;">
            <span class="n-ico">ℹ</span>
            <div>本次导入未生成新的初始密码（所有用户均已显式指定密码或导入失败）。</div>
          </div>
          <div class="modal-foot">
            <button class="btn btn-primary" @click="importOpen = false">完成</button>
          </div>
        </template>
      </div>
    </div>

    <!-- 新建用户弹窗 -->
    <div class="modal-mask" v-if="createOpen" @click.self="createOpen = false">
      <div class="modal">
        <h3 class="modal-title">新建用户</h3>
        <div class="field">
          <label class="field-label">用户名（登录工号）<span class="req">*</span></label>
          <input class="input" v-model.trim="createForm.username" placeholder="请输入用户名" autocomplete="off">
        </div>
        <div class="field">
          <label class="field-label">姓名<span class="req">*</span></label>
          <input class="input" v-model.trim="createForm.real_name" placeholder="请输入真实姓名">
        </div>
        <div class="field">
          <label class="field-label">初始密码</label>
          <input class="input" type="password" v-model="createForm.password"
                 placeholder="留空则自动生成随机初始密码" autocomplete="new-password">
          <p class="form-hint">留空时系统自动生成随机初始密码（至少8位），创建后请立即复制并通过安全渠道告知用户；用户首次登录须修改密码。</p>
        </div>
        <div class="field">
          <label class="field-label">工作端角色（至少选择一个）<span class="req">*</span></label>
          <div class="role-checks">
            <label class="check-card" :class="{ checked: createForm.is_teacher }">
              <input type="checkbox" v-model="createForm.is_teacher" :disabled="createForm.is_admin">教师端
            </label>
            <label class="check-card" :class="{ checked: createForm.is_leader }">
              <input type="checkbox" v-model="createForm.is_leader" :disabled="createForm.is_admin">专业负责人端
            </label>
            <label class="check-card" :class="{ checked: createForm.is_admin }">
              <input type="checkbox" v-model="createForm.is_admin" @change="onCreateAdminChange">管理员
            </label>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" @click="createOpen = false">取消</button>
          <button class="btn btn-primary" @click="doCreate" :disabled="saving">
            {{ saving ? '正在创建…' : '创建用户' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 编辑角色弹窗 -->
    <div class="modal-mask" v-if="rolesOpen" @click.self="rolesOpen = false">
      <div class="modal">
        <h3 class="modal-title">编辑角色 · {{ rolesTarget ? rolesTarget.real_name : '' }}</h3>
        <p class="form-hint" style="margin-bottom:12px;">至少保留一个工作端角色，否则无法保存。</p>
        <div class="role-checks">
          <label class="check-card" :class="{ checked: rolesForm.is_teacher }">
            <input type="checkbox" v-model="rolesForm.is_teacher" :disabled="rolesForm.is_admin">教师端
          </label>
          <label class="check-card" :class="{ checked: rolesForm.is_leader }">
            <input type="checkbox" v-model="rolesForm.is_leader" :disabled="rolesForm.is_admin">专业负责人端
          </label>
          <label class="check-card" :class="{ checked: rolesForm.is_admin }">
            <input type="checkbox" v-model="rolesForm.is_admin" @change="onRolesAdminChange">管理员
          </label>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" @click="rolesOpen = false">取消</button>
          <button class="btn btn-primary" @click="doRoles" :disabled="saving">
            {{ saving ? '正在保存…' : '保存' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 重置密码确认弹窗 -->
    <div class="modal-mask" v-if="resetOpen" @click.self="resetOpen = false">
      <div class="modal">
        <h3 class="modal-title">重置密码</h3>
        <p style="color:var(--ink-soft);line-height:1.8;margin:0 0 4px;">
          确定将用户 <b>{{ resetTarget ? resetTarget.real_name : '' }}（{{ resetTarget ? resetTarget.username : '' }}）</b>
          的密码重置为 <b style="color:var(--accent);">随机生成的新密码</b> 吗？
        </p>
        <p class="form-hint">重置后原密码立即失效，新密码仅在下一步显示一次，请立即复制并通过安全渠道告知该用户；该用户首次登录须修改密码。</p>
        <div class="modal-foot">
          <button class="btn btn-ghost" @click="resetOpen = false">取消</button>
          <button class="btn btn-accent" @click="doReset" :disabled="saving">
            {{ saving ? '正在重置…' : '确认重置' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 解绑钉钉确认弹窗 -->
    <div class="modal-mask" v-if="unbindDtOpen" @click.self="unbindDtOpen = false">
      <div class="modal">
        <h3 class="modal-title">解绑钉钉</h3>
        <p style="color:var(--ink-soft);line-height:1.8;margin:0 0 4px;">
          确定解除用户 <b>{{ unbindDtTarget ? unbindDtTarget.real_name : '' }}（{{ unbindDtTarget ? unbindDtTarget.username : '' }}）</b>
          的钉钉绑定吗？
        </p>
        <p class="form-hint">解绑后该用户将无法使用钉钉快捷登录，需重新绑定。</p>
        <div class="modal-foot">
          <button class="btn btn-ghost" @click="unbindDtOpen = false">取消</button>
          <button class="btn btn-accent" @click="doUnbindDt" :disabled="saving">
            {{ saving ? '正在解绑…' : '确认解绑' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 删除用户弹窗（红色警示 + 双重确认） -->
    <div class="modal-mask" v-if="deleteOpen" @click.self="deleteOpen = false">
      <div class="modal modal-danger">
        <h3 class="modal-title danger-title">⚠ 永久删除用户</h3>
        <div class="notice notice-red">
          <span class="n-ico">✕</span>
          <span>删除后将同时清除该用户的报告、措施、达成记录等全部业务数据，
          <b>不可恢复</b>。请务必确认后再操作。</span>
        </div>
        <div class="field">
          <label class="field-label">逐字输入被删除用户的用户名（{{ delTarget ? delTarget.username : '' }}）<span class="req">*</span></label>
          <input class="input" v-model.trim="delForm.confirm_username"
                 placeholder="请输入用户名以确认" autocomplete="off">
        </div>
        <div class="field">
          <label class="field-label">管理员本人密码（{{ me ? me.real_name : '' }}）<span class="req">*</span></label>
          <input class="input" type="password" v-model="delForm.admin_password"
                 placeholder="请输入您本人的登录密码" autocomplete="current-password">
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" @click="deleteOpen = false">取消</button>
          <button class="btn btn-accent" @click="doDelete" :disabled="saving || !delNameMatch">
            {{ saving ? '正在删除…' : '永久删除' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 初始密码展示弹窗（创建/重置后一次性显示） -->
    <div class="modal-mask" v-if="credOpen" @click.self="credOpen = false">
      <div class="modal">
        <h3 class="modal-title">{{ credInfo.title }}</h3>
        <div class="notice notice-blue" style="margin-bottom:14px;">
          <span class="n-ico">!</span>
          <span>以下初始密码<b>仅显示一次</b>，关闭后无法再次查看，请立即复制并通过安全渠道告知用户。该用户首次登录须修改密码。</span>
        </div>
        <div class="field">
          <label class="field-label">用户名</label>
          <div style="font-family:monospace;font-size:15px;padding:9px 12px;background:var(--surface-soft);border:1px solid var(--line);border-radius:6px;color:var(--ink);">{{ credInfo.username }}</div>
        </div>
        <div class="field">
          <label class="field-label">初始密码</label>
          <div style="display:flex;gap:10px;align-items:center;">
            <code style="flex:1;font-family:monospace;font-size:18px;letter-spacing:1px;padding:9px 12px;background:var(--surface-soft);border:1px solid var(--line);border-radius:6px;color:var(--accent);">{{ credInfo.password }}</code>
            <button class="btn btn-ghost btn-sm" @click="copyCred">复制</button>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-primary" @click="credOpen = false">我已保存，关闭</button>
        </div>
      </div>
    </div>
  </div>`,
  data: function () {
    return {
      loading: true,
      saving: false,
      users: [],
      dingtalkEnabled: false,
      createOpen: false,
      createForm: { username: '', real_name: '', password: '', is_teacher: true, is_leader: false, is_admin: false },
      rolesOpen: false,
      rolesTarget: null,
      rolesForm: { is_teacher: false, is_leader: false, is_admin: false },
      resetOpen: false,
      resetTarget: null,
      unbindDtOpen: false,
      unbindDtTarget: null,
      deleteOpen: false,
      delTarget: null,
      delForm: { confirm_username: '', admin_password: '' },
      importOpen: false,
      importFile: null,
      importing: false,
      importStep: 'upload',
      previewData: null,
      doneData: {},
      credOpen: false,
      credInfo: { title: '', username: '', password: '' }
    };
  },
  computed: {
    me: function () { return window.AppUser; },
    delNameMatch: function () {
      return !!this.delTarget && this.delForm.confirm_username === this.delTarget.username;
    },
    credentialsUrl: function () {
      return this.doneData && this.doneData.credentials_bundle
        ? '/api/admin/users/import/credentials/' + this.doneData.credentials_bundle
        : '';
    }
  },
  created: function () { this.load(); this.loadDingtalkConfig(); },
  methods: {
    onCreateAdminChange: function () {
      if (this.createForm.is_admin) {
        this.createForm.is_teacher = false;
        this.createForm.is_leader = false;
      }
    },
    onRolesAdminChange: function () {
      if (this.rolesForm.is_admin) {
        this.rolesForm.is_teacher = false;
        this.rolesForm.is_leader = false;
      }
    },
    openImport: function () {
      this.importFile = null;
      this.importStep = 'upload';
      this.previewData = null;
      this.doneData = {};
      this.importOpen = true;
    },
    onImportFile: function (e) {
      this.importFile = e.target.files[0] || null;
      this.importStep = 'upload';
      this.previewData = null;
    },
    async doPreview() {
      if (!this.importFile) { window.toast('请选择文件', 'error'); return; }
      this.importing = true;
      try {
        var fd = new FormData();
        fd.append('file', this.importFile);
        fd.append('dry_run', '1');
        var data = await window.API.raw('/api/admin/users/import', { method: 'POST', body: fd });
        this.previewData = data;
        this.importStep = 'preview';
      } catch (e) {
        window.toast(e.message, 'error');
      } finally {
        this.importing = false;
      }
    },
    async doConfirmImport() {
      if (!this.importFile) { window.toast('请选择文件', 'error'); return; }
      this.importing = true;
      try {
        var fd = new FormData();
        fd.append('file', this.importFile);
        var data = await window.API.raw('/api/admin/users/import', { method: 'POST', body: fd });
        this.doneData = data || {};
        this.importStep = 'done';
        this.previewData = null;
        this.importFile = null;
        window.toast('导入完成：成功 ' + data.success_count + ' 人', data.failed_count ? 'warn' : 'success');
        this.load();
      } catch (e) {
        window.toast(e.message, 'error');
      } finally {
        this.importing = false;
      }
    },
    async load() {
      this.loading = true;
      try {
        this.users = await window.API.get('/api/admin/users') || [];
      } catch (e) {
        window.toast(e.message, 'error');
      } finally {
        this.loading = false;
      }
    },
    openCreate: function () {
      this.createForm = { username: '', real_name: '', password: '', is_teacher: true, is_leader: false, is_admin: false };
      this.createOpen = true;
    },
    async doCreate() {
      var f = this.createForm;
      if (!f.username || !f.real_name) { window.toast('请填写用户名与姓名', 'error'); return; }
      if (!f.is_teacher && !f.is_leader && !f.is_admin) {
        window.toast('请至少选择一个工作端角色', 'error'); return;
      }
      var payload = {
        username: f.username,
        real_name: f.real_name,
        is_teacher: f.is_teacher ? 1 : 0,
        is_leader: f.is_leader ? 1 : 0,
        is_admin: f.is_admin ? 1 : 0
      };
      if (f.password) payload.password = f.password;
      this.saving = true;
      try {
        var data = await window.API.post('/api/admin/users', payload);
        window.toast('用户创建成功', 'success');
        this.createOpen = false;
        if (data && data.initial_password) {
          this.credInfo = { title: '初始密码（请立即保存）', username: data.username, password: data.initial_password };
          this.credOpen = true;
        }
        this.load();
      } catch (e) {
        window.toast(e.message, 'error');
      } finally {
        this.saving = false;
      }
    },
    openRoles: function (u) {
      this.rolesTarget = u;
      this.rolesForm = {
        is_teacher: !!u.is_teacher,
        is_leader: !!u.is_leader,
        is_admin: !!u.is_admin
      };
      this.rolesOpen = true;
    },
    async doRoles() {
      var f = this.rolesForm;
      if (!f.is_teacher && !f.is_leader && !f.is_admin) {
        window.toast('请至少保留一个工作端角色', 'error'); return;
      }
      this.saving = true;
      try {
        await window.API.patch('/api/admin/users/' + this.rolesTarget.id, {
          is_teacher: f.is_teacher ? 1 : 0,
          is_leader: f.is_leader ? 1 : 0,
          is_admin: f.is_admin ? 1 : 0
        });
        window.toast('角色已更新', 'success');
        this.rolesOpen = false;
        this.load();
      } catch (e) {
        window.toast(e.message, 'error');
      } finally {
        this.saving = false;
      }
    },
    askReset: function (u) {
      this.resetTarget = u;
      this.resetOpen = true;
    },
    async doReset() {
      this.saving = true;
      try {
        var data = await window.API.post('/api/admin/users/' + this.resetTarget.id + '/reset-password');
        this.resetOpen = false;
        if (data && data.new_password) {
          this.credInfo = { title: '重置后的新密码（请立即保存）', username: data.username, password: data.new_password };
          this.credOpen = true;
          window.toast('密码已重置为随机新密码', 'success');
        } else {
          window.toast('密码已重置', 'success');
        }
        this.load();
      } catch (e) {
        window.toast(e.message, 'error');
      } finally {
        this.saving = false;
      }
    },
    copyCred: function () {
      var pwd = this.credInfo.password || '';
      var done = function () { window.toast('已复制到剪贴板', 'success'); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(pwd).then(done).catch(function () { window.toast('复制失败，请手动选择复制', 'error'); });
      } else {
        var ta = document.createElement('textarea');
        ta.value = pwd;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); done(); }
        catch (e) { window.toast('复制失败，请手动选择复制', 'error'); }
        document.body.removeChild(ta);
      }
    },
    async toggleDisabled(u) {
      try {
        await window.API.patch('/api/admin/users/' + u.id, { is_disabled: u.is_disabled ? 0 : 1 });
        window.toast(u.is_disabled ? '账号已启用' : '账号已停用', 'success');
        this.load();
      } catch (e) {
        window.toast(e.message, 'error');
      }
    },
    openDelete: function (u) {
      this.delTarget = u;
      this.delForm = { confirm_username: '', admin_password: '' };
      this.deleteOpen = true;
    },
    async loadDingtalkConfig() {
      try {
        var cfg = await window.API.get('/api/auth/dingtalk/config');
        this.dingtalkEnabled = cfg.enabled;
      } catch (e) { /* 忽略 */ }
    },
    openUnbindDt: function (u) {
      this.unbindDtTarget = u;
      this.unbindDtOpen = true;
    },
    async doUnbindDt() {
      this.saving = true;
      try {
        await window.API.post('/api/admin/users/' + this.unbindDtTarget.id + '/unbind-dingtalk');
        window.toast('已解绑钉钉', 'success');
        this.unbindDtOpen = false;
        this.load();
      } catch (e) {
        window.toast(e.message, 'error');
      } finally {
        this.saving = false;
      }
    },
    async doDelete() {
      if (!this.delNameMatch) { window.toast('请输入与被删除用户一致的用户名', 'error'); return; }
      if (!this.delForm.admin_password) { window.toast('请输入管理员本人密码', 'error'); return; }
      this.saving = true;
      try {
        await window.API.del('/api/admin/users/' + this.delTarget.id, {
          confirm_username: this.delForm.confirm_username,
          admin_password: this.delForm.admin_password
        });
        window.toast('用户已永久删除', 'success');
        this.deleteOpen = false;
        this.load();
      } catch (e) {
        window.toast(e.message, 'error');
      } finally {
        this.saving = false;
      }
    }
  }
};
