/* ============================================================
 * views/report-create.js —— 新建报告：课程四级联动下拉 + .docx 上传
 * ============================================================ */
window.VIEWS.ReportCreate = {
  name: 'ReportCreate',
  template: `
  <div class="page" style="max-width:760px;">
    <div class="page-head">
      <div>
        <h1 class="page-title">新建报告</h1>
        <p class="page-sub">选择课程并上传课程考核报告（.docx），系统将自动抽取文本用于生成改进措施</p>
      </div>
    </div>

    <div class="card">
      <div v-if="loadingDict" class="loading">正在加载课程字典</div>
      <form v-else @submit.prevent="submit">
        <div class="notice notice-amber" v-if="expiredNotice">
          <span class="n-ico">⚠</span>
          <span>{{ expiredNotice }}</span>
        </div>
        <div class="form-row">
          <div class="field">
            <label class="field-label">学年<span class="req">*</span></label>
            <select class="select" v-model="year" @change="onYearChange">
              <option value="">请选择学年</option>
              <option v-for="y in years" :key="y" :value="y">{{ y }}</option>
            </select>
          </div>
          <div class="field">
            <label class="field-label">学期<span class="req">*</span></label>
            <select class="select" v-model="term" :disabled="!year" @change="onTermChange">
              <option value="">请选择学期</option>
              <option v-for="t in terms" :key="t" :value="t">{{ t }}</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="field">
            <label class="field-label">课程名称<span class="req">*</span></label>
            <select class="select" v-model="courseId" :disabled="!term">
              <option value="">请选择课程</option>
              <option v-for="c in courseOptions" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </div>
          <div class="field">
            <label class="field-label">课程代码</label>
            <input class="input" :value="courseCode" disabled placeholder="选择课程后自动带出">
          </div>
        </div>
        <p class="form-hint" v-if="selectedCourse">
          开课周期：{{ selectedCourse.start_date || '—' }} 至 {{ selectedCourse.end_date || '—' }}
        </p>

        <hr class="divider">

        <div class="field">
          <label class="field-label">课程考核报告文件（.docx）<span class="req">*</span></label>
          <div class="upload-zone" :class="{ 'has-file': file }" @click="pickFile">
            <template v-if="!file">
              <span class="up-ico">📄</span>
              <div>点击选择 .docx 文件</div>
              <div class="cell-muted" style="margin-top:4px;">仅支持 Word 文档格式</div>
            </template>
            <template v-else>
              <span class="up-ico">✅</span>
              <div class="up-name">{{ file.name }}</div>
              <div class="cell-muted" style="margin-top:4px;">{{ fileSizeText }} · 点击可重新选择</div>
            </template>
          </div>
          <input type="file" ref="fileInput" accept=".docx" style="display:none;" @change="onFile">
        </div>

        <div class="btn-row" style="display:flex;gap:12px;margin-top:22px;">
          <button class="btn btn-primary" type="submit" :disabled="submitting" style="padding:10px 34px;">
            {{ submitting ? '正在提交…' : '提交报告' }}
          </button>
          <router-link class="btn btn-ghost" to="/teacher/dashboard" style="padding:10px 24px;">取消</router-link>
        </div>
      </form>
    </div>
  </div>`,
  data: function () {
    return {
      loadingDict: true,
      courses: [],
      year: '',
      term: '',
      courseId: '',
      file: null,
      submitting: false
    };
  },
  computed: {
    years: function () {
      var seen = {};
      return this.courses.map(function (c) { return c.academic_year; })
        .filter(function (y) {
          if (!y || seen[y]) return false;
          seen[y] = 1;
          return true;
        });
    },
    terms: function () {
      var seen = {};
      var year = this.year;
      return this.courses.filter(function (c) { return c.academic_year === year; })
        .map(function (c) { return c.term; })
        .filter(function (t) {
          if (!t || seen[t]) return false;
          seen[t] = 1;
          return true;
        });
    },
    courseOptions: function () {
      var year = this.year, term = this.term;
      return this.courses.filter(function (c) {
        return c.academic_year === year && c.term === term;
      });
    },
    selectedCourse: function () {
      var id = this.courseId;
      return this.courses.find(function (c) { return c.id === id; }) || null;
    },
    courseCode: function () {
      return this.selectedCourse ? this.selectedCourse.code : '';
    },
    expiredNotice: function () {
      var c = this.selectedCourse;
      if (!c || !c.end_date) return '';
      var end = String(c.end_date).slice(0, 10);
      if (window.todayStr() > end) {
        return '该课程学期已于 ' + end + ' 截止，您仍可提交，但请留意时效性。';
      }
      return '';
    },
    fileSizeText: function () {
      if (!this.file) return '';
      var kb = this.file.size / 1024;
      return kb > 1024 ? (kb / 1024).toFixed(1) + ' MB' : Math.ceil(kb) + ' KB';
    }
  },
  created: async function () {
    try {
      var dict = await window.API.get('/api/dictionaries');
      this.courses = dict.courses || [];
    } catch (e) {
      window.toast(e.message, 'error');
    } finally {
      this.loadingDict = false;
    }
  },
  methods: {
    onYearChange: function () { this.term = ''; this.courseId = ''; },
    onTermChange: function () { this.courseId = ''; },
    pickFile: function () { this.$refs.fileInput.click(); },
    onFile: function (evt) {
      var f = evt.target.files[0] || null;
      if (f && !f.name.toLowerCase().endsWith('.docx')) {
        window.toast('仅支持 .docx 格式的报告文件', 'error');
        evt.target.value = '';
        return;
      }
      this.file = f;
    },
    async submit() {
      if (!this.courseId) { window.toast('请完整选择学年、学期与课程', 'error'); return; }
      if (!this.file) { window.toast('请上传报告文件', 'error'); return; }
      this.submitting = true;
      try {
        var fd = new FormData();
        fd.append('course_id', String(this.courseId));
        fd.append('file', this.file);
        await window.API.upload('/api/reports', fd);
        window.toast('报告创建成功，请前往生成改进措施', 'success');
        this.$router.push('/teacher/dashboard');
      } catch (e) {
        window.toast(e.message, 'error');
      } finally {
        this.submitting = false;
      }
    }
  }
};
