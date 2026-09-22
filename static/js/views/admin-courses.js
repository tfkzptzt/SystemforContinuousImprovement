/* ============================================================
 * views/admin-courses.js —— 管理后台 · 课程管理
 * 课程列表 / 新建课程 / 指派或更换课程负责人
 * ============================================================ */
window.VIEWS.AdminCourses = {
  name: 'AdminCourses',
  template: `
  <div class="page">
    <div class="page-head">
      <div>
        <h1 class="page-title">课程管理</h1>
        <p class="page-sub">维护课程档案与开课起止时间，为课程指派专业负责人</p>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-outline" @click="openImport">导入课程</button>
        <button class="btn btn-primary" @click="openCreate">＋ 新建课程</button>
      </div>
    </div>

    <div class="card tight">
      <div v-if="loading" class="loading">正在加载课程列表</div>
      <div v-else-if="!courses.length" class="empty">
        <span class="e-mark">◇</span>暂无课程，请先新建
      </div>
      <div class="table-wrap" v-else>
        <table class="tbl">
          <thead>
            <tr>
              <th>课程名称</th>
              <th>编号</th>
              <th>学年</th>
              <th>学期</th>
              <th>起止时间</th>
              <th>负责人</th>
              <th>报告数</th>
              <th style="text-align:right;">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in courses" :key="c.id">
              <td class="cell-strong">{{ c.name }}</td>
              <td><span class="cell-code">{{ c.code }}</span></td>
              <td>{{ c.academic_year }}</td>
              <td>{{ c.term }}</td>
              <td class="cell-muted">{{ c.start_date || '—' }} 至 {{ c.end_date || '—' }}</td>
              <td>
                <span v-if="c.leader_id">{{ c.leader_name || '—' }}</span>
                <span class="badge badge-amber" v-else>待指派</span>
              </td>
              <td>{{ reportCountOf(c) }}</td>
              <td>
                <div class="row-actions" style="justify-content:flex-end;">
                  <button class="btn btn-ghost btn-sm" @click="openAssign(c)">
                    {{ c.leader_id ? '更换负责人' : '指派负责人' }}
                  </button>
                  <button class="btn btn-danger btn-sm" @click="askDelete(c)">删除</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 新建课程弹窗 -->
    <div class="modal-mask" v-if="createOpen" @click.self="createOpen = false">
      <div class="modal" style="width:560px;">
        <h3 class="modal-title">新建课程</h3>
        <div class="form-row">
          <div class="field">
            <label class="field-label">课程名称<span class="req">*</span></label>
            <input class="input" v-model.trim="form.name" placeholder="例如：工程制图">
          </div>
          <div class="field">
            <label class="field-label">课程编号<span class="req">*</span></label>
            <input class="input" v-model.trim="form.code" placeholder="例如：ME1001">
          </div>
        </div>
        <div class="form-row">
          <div class="field">
            <label class="field-label">学年<span class="req">*</span></label>
            <select class="select" v-model="form.academic_year" @change="onYearChange">
              <option value="">请选择学年</option>
              <option v-for="y in yearsData" :key="y.id" :value="y.name">{{ y.name }}（{{ y.semester_count }}个学期）</option>
            </select>
          </div>
          <div class="field">
            <label class="field-label">学期<span class="req">*</span></label>
            <select class="select" v-model="form.term">
              <option value="">请选择学期</option>
              <option v-for="t in termOptions" :key="t" :value="t">{{ t }}</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="field">
            <label class="field-label">开始日期<span class="req">*</span></label>
            <input class="input" type="date" v-model="form.start_date">
          </div>
          <div class="field">
            <label class="field-label">结束日期<span class="req">*</span></label>
            <input class="input" type="date" v-model="form.end_date">
          </div>
        </div>
        <div class="field">
          <label class="field-label">专业负责人</label>
          <select class="select" v-model="form.leader_id">
            <option :value="0">暂不指派</option>
            <option v-for="l in leaders" :key="l.id" :value="l.id">{{ l.real_name }}（{{ l.username }}）</option>
          </select>
          <p class="form-hint">可稍后在课程列表中随时指派或更换。</p>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" @click="createOpen = false">取消</button>
          <button class="btn btn-primary" @click="doCreate" :disabled="saving">
            {{ saving ? '正在创建…' : '创建课程' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 指派 / 更换负责人弹窗 -->
    <div class="modal-mask" v-if="assignOpen" @click.self="assignOpen = false">
      <div class="modal">
        <h3 class="modal-title">{{ assignTarget && assignTarget.leader_id ? '更换负责人' : '指派负责人' }} · {{ assignTarget ? assignTarget.name : '' }}</h3>
        <div class="field" style="margin-bottom:0;">
          <label class="field-label">专业负责人<span class="req">*</span></label>
          <select class="select" v-model="assignLeaderId">
            <option :value="0">暂不指派</option>
            <option v-for="l in leaders" :key="l.id" :value="l.id">{{ l.real_name }}（{{ l.username }}）</option>
          </select>
          <p class="form-hint" v-if="!leaders.length">暂无可用的专业负责人，请先在「用户管理」中为账号授予负责人端角色。</p>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" @click="assignOpen = false">取消</button>
          <button class="btn btn-primary" @click="doAssign" :disabled="saving">
            {{ saving ? '正在保存…' : '保存' }}
          </button>
        </div>
      </div>
    </div>
    <!-- 删除课程确认弹窗（需手动输入名称+编号二次确认） -->
    <div class="modal-mask" v-if="deleteOpen" @click.self="deleteOpen = false">
      <div class="modal modal-danger">
        <h3 class="modal-title danger-title">⚠ 删除课程</h3>
        <div class="notice notice-red">
          <span class="n-ico">✕</span>
          <span>
            即将删除课程 <b>{{ delTarget ? delTarget.name : '' }}</b>（{{ delTarget ? delTarget.code : '' }}）。
            <template v-if="delReportCount">该课程下的 <b>{{ delReportCount }}</b> 份报告及其措施、达成、退回记录与上传文件将<b>一并删除</b>。</template>
            此操作<b>不可恢复</b>，请务必确认后再操作。
          </span>
        </div>
        <div class="field">
          <label class="field-label">请输入课程名称<span class="req">*</span></label>
          <input class="input" v-model="delForm.name"
                 :placeholder="delTarget ? delTarget.name : ''" autocomplete="off">
        </div>
        <div class="field" style="margin-bottom:0;">
          <label class="field-label">请输入课程编号<span class="req">*</span></label>
          <input class="input" v-model="delForm.code"
                 :placeholder="delTarget ? delTarget.code : ''" autocomplete="off">
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" @click="deleteOpen = false">取消</button>
          <button class="btn btn-danger" @click="doDelete" :disabled="saving || !delMatch">
            {{ saving ? '正在删除…' : '确认删除' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 导入课程弹窗 -->
    <div class="modal-mask" v-if="importOpen" @click.self="importOpen = false">
      <div class="modal" style="width:700px;">
        <h3 class="modal-title">批量导入课程</h3>
        <p style="color:var(--ink-soft);font-size:13px;margin:0 0 8px;">
          下载模板，填写课程信息后上传。学期填数字（1=第一学期，2=第二学期…），负责人填用户名（留空暂不指派）
        </p>

        <!-- 步骤1：上传文件 -->
        <template v-if="importStep === 'upload'">
          <div class="field">
            <label class="field-label">下载模板</label>
            <a class="btn btn-ghost btn-sm" href="/api/admin/courses/import/template" download>下载导入模板.xlsx</a>
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
            <span class="badge badge-green" v-if="previewData.success_count">可导入 {{ previewData.success_count }} 门</span>
            <span class="badge badge-red" v-if="previewData.failed_count" style="margin-left:6px;">失败 {{ previewData.failed_count }} 门</span>
          </div>
          <div class="table-wrap" style="max-height:320px;overflow:auto;margin-bottom:12px;" v-if="previewData.preview_rows && previewData.preview_rows.length">
            <table class="tbl">
              <thead><tr><th>行</th><th>课程名称</th><th>编号</th><th>学年</th><th>学期</th><th>起止日期</th><th>负责人</th></tr></thead>
              <tbody>
                <tr v-for="r in previewData.preview_rows" :key="r.row">
                  <td>{{ r.row }}</td>
                  <td class="cell-strong">{{ r.name }}</td>
                  <td><span class="cell-code">{{ r.code }}</span></td>
                  <td>{{ r.academic_year }}</td>
                  <td>{{ r.term }}</td>
                  <td class="cell-muted">{{ r.start_date }} 至 {{ r.end_date }}</td>
                  <td>{{ r.leader }}</td>
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
  </div>`,
  data: function () {
    return {
      loading: true,
      saving: false,
      courses: [],
      academicYears: [],
      yearsData: [],
      leaders: [],
      createOpen: false,
      form: { name: '', code: '', academic_year: '', term: '', start_date: '', end_date: '', leader_id: 0 },
      assignOpen: false,
      assignTarget: null,
      assignLeaderId: 0,
      deleteOpen: false,
      delTarget: null,
      delForm: { name: '', code: '' },
      importOpen: false,
      importFile: null,
      importing: false,
      importStep: 'upload',
      previewData: null
    };
  },
  created: function () { this.load(); },
  computed: {
    delReportCount: function () {
      return this.delTarget ? this.reportCountOf(this.delTarget) : 0;
    },
    delMatch: function () {
      if (!this.delTarget) return false;
      return this.delForm.name.trim() === (this.delTarget.name || '').trim() &&
             this.delForm.code.trim() === (this.delTarget.code || '').trim();
    },
    termOptions: function () {
      var yearName = this.form.academic_year;
      if (!yearName) return [];
      var year = this.yearsData.find(function (y) { return y.name === yearName; });
      if (!year) return [];
      var count = year.semester_count || 2;
      var cn = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
      var terms = [];
      for (var i = 1; i <= count; i++) { terms.push('第' + cn[i] + '学期'); }
      return terms;
    }
  },
  methods: {
    emptyForm: function () {
      return { name: '', code: '', academic_year: '', term: '', start_date: '', end_date: '', leader_id: 0 };
    },
    reportCountOf: function (c) {
      if (c.report_count != null) return c.report_count;
      if (c.reports_count != null) return c.reports_count;
      return 0;
    },
    async load() {
      this.loading = true;
      try {
        var results = await Promise.all([
          window.API.get('/api/admin/courses'),
          window.API.get('/api/dictionaries'),
          window.API.get('/api/admin/users'),
          window.API.get('/api/admin/years')
        ]);
        this.courses = results[0] || [];
        this.academicYears = (results[1] && results[1].academic_years) || [];
        this.yearsData = results[3] || [];
        this.leaders = (results[2] || []).filter(function (u) {
          return u.is_leader && !u.is_disabled;
        });
      } catch (e) {
        window.toast(e.message, 'error');
      } finally {
        this.loading = false;
      }
    },
    openCreate: function () {
      this.form = this.emptyForm();
      this.createOpen = true;
    },
    onYearChange: function () {
      this.form.term = '';
    },
    async doCreate() {
      var f = this.form;
      if (!f.name || !f.code || !f.academic_year || !f.term || !f.start_date || !f.end_date) {
        window.toast('请完整填写课程信息', 'error'); return;
      }
      if (f.start_date > f.end_date) {
        window.toast('开始日期不能晚于结束日期', 'error'); return;
      }
      var payload = {
        name: f.name,
        code: f.code,
        academic_year: f.academic_year,
        term: f.term,
        start_date: f.start_date,
        end_date: f.end_date
      };
      if (f.leader_id) payload.leader_id = f.leader_id;
      this.saving = true;
      try {
        await window.API.post('/api/admin/courses', payload);
        window.toast('课程创建成功', 'success');
        this.createOpen = false;
        this.load();
      } catch (e) {
        window.toast(e.message, 'error');
      } finally {
        this.saving = false;
      }
    },
    openAssign: function (c) {
      this.assignTarget = c;
      this.assignLeaderId = c.leader_id || 0;
      this.assignOpen = true;
    },
    async doAssign() {
      this.saving = true;
      try {
        await window.API.patch('/api/admin/courses/' + this.assignTarget.id + '/leader', {
          leader_id: this.assignLeaderId || null
        });
        window.toast(this.assignLeaderId ? '负责人已更新' : '已取消负责人指派', 'success');
        this.assignOpen = false;
        this.load();
      } catch (e) {
        window.toast(e.message, 'error');
      } finally {
        this.saving = false;
      }
    },
    askDelete: function (c) {
      this.delTarget = c;
      this.delForm = { name: '', code: '' };
      this.deleteOpen = true;
    },
    async doDelete() {
      if (!this.delMatch) { window.toast('请输入与课程一致的名称与编号', 'error'); return; }
      this.saving = true;
      try {
        var res = await window.API.del('/api/admin/courses/' + this.delTarget.id, {
          name: this.delForm.name.trim(),
          code: this.delForm.code.trim()
        });
        var n = res && res.deleted_reports ? res.deleted_reports : 0;
        window.toast(n ? '课程已删除，同时删除 ' + n + ' 份报告' : '课程已删除', 'success');
        this.deleteOpen = false;
        this.load();
      } catch (e) {
        window.toast(e.message, 'error');
      } finally {
        this.saving = false;
      }
    },
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
        var data = await window.API.raw('/api/admin/courses/import', { method: 'POST', body: fd });
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
        var data = await window.API.raw('/api/admin/courses/import', { method: 'POST', body: fd });
        window.toast('导入完成：成功 ' + data.success_count + ' 门', data.failed_count ? 'warn' : 'success');
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
    }
  }
};
