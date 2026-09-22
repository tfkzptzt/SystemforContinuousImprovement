/* ============================================================
 * views/history-query.js —— 历史追溯查询：按学年/学期/课程/教师筛选
 * ============================================================ */
window.VIEWS.HistoryQuery = {
  name: 'HistoryQuery',
  template: `
  <div class="page">
    <div class="page-head">
      <div>
        <h1 class="page-title">历史追溯查询</h1>
        <p class="page-sub">按学年、学期、课程、教师检索持续改进记录，点击行查看完整时间线</p>
      </div>
    </div>

    <div class="card">
      <div class="filter-bar">
        <div class="field">
          <label class="field-label">学年</label>
          <select class="select" v-model="fYear">
            <option value="">全部学年</option>
            <option v-for="y in yearOptions" :key="y" :value="y">{{ y }}</option>
          </select>
        </div>
        <div class="field">
          <label class="field-label">学期</label>
          <select class="select" v-model="fTerm">
            <option value="">全部学期</option>
            <option v-for="t in termOptions" :key="t" :value="t">{{ t }}</option>
          </select>
        </div>
        <div class="field">
          <label class="field-label">课程</label>
          <select class="select" v-model="fCourse">
            <option value="">全部课程</option>
            <option v-for="c in courseOptions" :key="c" :value="c">{{ c }}</option>
          </select>
        </div>
        <div class="field" v-if="showTeacherFilter">
          <label class="field-label">教师</label>
          <select class="select" v-model="fTeacher">
            <option value="">全部教师</option>
            <option v-for="t in teacherOptions" :key="t" :value="t">{{ t }}</option>
          </select>
        </div>
        <button class="btn btn-ghost" @click="resetFilters" style="margin-bottom:1px;">重置</button>
      </div>
    </div>

    <div class="card tight">
      <div v-if="loading" class="loading">正在查询记录</div>
      <div v-else-if="!filtered.length" class="empty">
        <span class="e-mark">溯</span>未查询到符合条件的记录
      </div>
      <div class="table-wrap" v-else>
        <table class="tbl">
          <thead>
            <tr>
              <th>课程名称</th>
              <th>课程代码</th>
              <th>学年 / 学期</th>
              <th>提交教师</th>
              <th>状态</th>
              <th>创建时间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in filtered" :key="r.id" style="cursor:pointer;"
                @click="$router.push('/records/' + r.id)">
              <td>
                <div class="cell-strong">{{ r.course_name }}</div>
                <div class="cell-muted">{{ r.title }}</div>
              </td>
              <td><span class="cell-code">{{ r.course_code }}</span></td>
              <td>{{ r.academic_year }} · {{ r.term }}</td>
              <td>{{ r.teacher_name }}</td>
              <td><span class="badge" :class="statusMeta(r.status).cls">{{ statusMeta(r.status).label }}</span></td>
              <td class="cell-muted">{{ fmtTime(r.created_at) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="form-hint" style="margin:10px 16px 4px;" v-if="!loading">
        共 {{ filtered.length }} 条记录 · 点击任意行可查看完整改进时间线
      </p>
    </div>
  </div>`,
  data: function () {
    return {
      loading: true,
      reports: [],
      fYear: '',
      fTerm: '',
      fCourse: '',
      fTeacher: ''
    };
  },
  computed: {
    isLeader: function () {
      return window.AppUser && !!window.AppUser.is_leader;
    },
    showTeacherFilter: function () { return this.isLeader; },
    yearOptions: function () { return this.unique('academic_year'); },
    termOptions: function () { return this.unique('term'); },
    courseOptions: function () { return this.unique('course_name'); },
    teacherOptions: function () { return this.unique('teacher_name'); },
    filtered: function () {
      var f = this;
      return this.reports.filter(function (r) {
        if (f.fYear && r.academic_year !== f.fYear) return false;
        if (f.fTerm && r.term !== f.fTerm) return false;
        if (f.fCourse && r.course_name !== f.fCourse) return false;
        if (f.fTeacher && r.teacher_name !== f.fTeacher) return false;
        return true;
      });
    }
  },
  created: async function () {
    try {
      this.reports = await window.API.get('/api/reports');
    } catch (e) {
      window.toast(e.message, 'error');
    } finally {
      this.loading = false;
    }
  },
  methods: {
    statusMeta: window.statusMeta,
    fmtTime: window.fmtTime,
    unique: function (key) {
      var seen = {};
      return this.reports.map(function (r) { return r[key]; })
        .filter(function (v) {
          if (!v || seen[v]) return false;
          seen[v] = 1;
          return true;
        })
        .sort();
    },
    resetFilters: function () {
      this.fYear = '';
      this.fTerm = '';
      this.fCourse = '';
      this.fTeacher = '';
    }
  }
};
