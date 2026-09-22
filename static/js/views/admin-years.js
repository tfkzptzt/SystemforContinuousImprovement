/* ============================================================
 * views/admin-years.js —— 管理后台 · 学年管理
 * 学年列表（含课程数）/ 新增学年 / 删除学年（有课程时后端拒绝）
 * ============================================================ */
window.VIEWS.AdminYears = {
  name: 'AdminYears',
  template: `
  <div class="page" style="max-width:860px;">
    <div class="page-head">
      <div>
        <h1 class="page-title">学年管理</h1>
        <p class="page-sub">维护学年档案，课程按学年归档，<a style="color:var(--ink);">存在课程的学年不可删除</a></p>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-outline" @click="openImport">导入学年</button>
        <button class="btn btn-primary" @click="openCreate">＋ 新增学年</button>
      </div>
    </div>

    <div class="card tight">
      <div v-if="loading" class="loading">正在加载学年列表</div>
      <div v-else-if="!years.length" class="empty">
        <span class="e-mark">◇</span>暂无学年，请先新增
      </div>
      <div class="table-wrap" v-else>
        <table class="tbl">
          <thead>
            <tr>
              <th>学年名称</th>
              <th>学期数</th>
              <th>课程数</th>
              <th style="text-align:right;">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="y in years" :key="y.id">
              <td class="cell-strong">{{ y.name }}</td>
              <td>{{ y.semester_count }} 个学期</td>
              <td><span class="badge badge-blue">{{ y.course_count }} 门课程</span></td>
              <td>
                <div class="row-actions" style="justify-content:flex-end;">
                  <button class="btn btn-danger btn-sm" @click="askDelete(y)">删除</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 新增学年弹窗 -->
    <div class="modal-mask" v-if="createOpen" @click.self="createOpen = false">
      <div class="modal">
        <h3 class="modal-title">新增学年</h3>
        <div class="field">
          <label class="field-label">学年名称<span class="req">*</span></label>
          <input class="input" v-model.trim="newName" placeholder="例如：2025-2026学年" @keyup.enter="doCreate">
          <p class="form-hint">命名建议：起始年-结束年学年，如「2025-2026学年」。</p>
        </div>
        <div class="field">
          <label class="field-label">学期数量</label>
          <input class="input" type="number" v-model.number="newSemesterCount" min="1" max="10" style="width:120px;">
          <p class="form-hint">该学年包含几个学期，默认 2 个（第一学期、第二学期……）</p>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" @click="createOpen = false">取消</button>
          <button class="btn btn-primary" @click="doCreate" :disabled="saving">
            {{ saving ? '正在创建…' : '创建学年' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 导入学年弹窗 -->
    <div class="modal-mask" v-if="importOpen" @click.self="importOpen = false">
      <div class="modal" style="width:600px;">
        <h3 class="modal-title">批量导入学年</h3>
        <p style="color:var(--ink-soft);font-size:13px;margin:0 0 12px;">
          下载模板，填写学年名称和学期数（留空默认2学期），然后上传文件
        </p>

        <!-- 步骤1：上传文件 -->
        <template v-if="importStep === 'upload'">
          <div class="field">
            <label class="field-label">下载模板</label>
            <a class="btn btn-ghost btn-sm" href="/api/admin/years/import/template" download>下载导入模板.xlsx</a>
          </div>
          <div class="field">
            <label class="field-label">选择文件</label>
            <input type="file" accept=".xlsx,.csv" @change="onImportFile">
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
            <span class="badge badge-green" v-if="previewData.success_count">可导入 {{ previewData.success_count }} 条</span>
            <span class="badge badge-red" v-if="previewData.failed_count" style="margin-left:6px;">失败 {{ previewData.failed_count }} 条</span>
          </div>
          <div class="table-wrap" style="max-height:320px;overflow:auto;margin-bottom:12px;" v-if="previewData.preview_rows && previewData.preview_rows.length">
            <table class="tbl">
              <thead><tr><th>行</th><th>学年名称</th><th>学期数</th></tr></thead>
              <tbody>
                <tr v-for="r in previewData.preview_rows" :key="r.row">
                  <td>{{ r.row }}</td><td class="cell-strong">{{ r.name }}</td><td>{{ r.semester_count }}</td>
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
      </div>
    </div>

    <!-- 删除确认弹窗 -->
    <div class="modal-mask" v-if="deleteOpen" @click.self="deleteOpen = false">
      <div class="modal">
        <h3 class="modal-title">删除学年</h3>
        <p style="color:var(--ink-soft);line-height:1.8;margin:0;">
          确定删除学年 <b>{{ delTarget ? delTarget.name : '' }}</b> 吗？
          <span v-if="delTarget && delTarget.course_count">该学年下仍有课程，删除将被系统拒绝。</span>
        </p>
        <div class="modal-foot">
          <button class="btn btn-ghost" @click="deleteOpen = false">取消</button>
          <button class="btn btn-accent" @click="doDelete" :disabled="saving">
            {{ saving ? '正在删除…' : '确认删除' }}
          </button>
        </div>
      </div>
    </div>
  </div>`,
  data: function () {
    return {
      loading: true,
      saving: false,
      years: [],
      createOpen: false,
      newName: '',
      newSemesterCount: 2,
      deleteOpen: false,
      delTarget: null,
      importOpen: false,
      importFile: null,
      importing: false,
      importStep: 'upload',
      previewData: null
    };
  },
  created: function () { this.load(); },
  methods: {
    openImport: function () {
      this.importFile = null;
      this.importStep = 'upload';
      this.previewData = null;
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
        var data = await window.API.raw('/api/admin/years/import', { method: 'POST', body: fd });
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
        var data = await window.API.raw('/api/admin/years/import', { method: 'POST', body: fd });
        window.toast('导入完成：成功 ' + data.success_count + ' 条', data.failed_count ? 'warn' : 'success');
        this.importOpen = false;
        this.importStep = 'upload';
        this.previewData = null;
        this.importFile = null;
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
        this.years = await window.API.get('/api/admin/years') || [];
      } catch (e) {
        window.toast(e.message, 'error');
      } finally {
        this.loading = false;
      }
    },
    openCreate: function () {
      this.newName = '';
      this.newSemesterCount = 2;
      this.createOpen = true;
    },
    async doCreate() {
      if (!this.newName) { window.toast('请输入学年名称', 'error'); return; }
      if (!this.newSemesterCount || this.newSemesterCount < 1) { window.toast('学期数量至少为1', 'error'); return; }
      this.saving = true;
      try {
        await window.API.post('/api/admin/years', { name: this.newName, semester_count: this.newSemesterCount });
        window.toast('学年创建成功', 'success');
        this.createOpen = false;
        this.load();
      } catch (e) {
        window.toast(e.message, 'error');
      } finally {
        this.saving = false;
      }
    },
    askDelete: function (y) {
      this.delTarget = y;
      this.deleteOpen = true;
    },
    async doDelete() {
      this.saving = true;
      try {
        await window.API.del('/api/admin/years/' + this.delTarget.id);
        window.toast('学年已删除', 'success');
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
