/* ============================================================
 * views/teacher-records.js —— 我的全部记录（含已完结），点击查看完整时间线
 * ============================================================ */
window.VIEWS.TeacherRecords = {
  name: 'TeacherRecords',
  template: `
  <div class="page">
    <div class="page-head">
      <div>
        <h1 class="page-title">我的记录</h1>
        <p class="page-sub">全部持续改进记录（含已完结），点击「查看时间线」追溯完整流程</p>
      </div>
      <div class="field" style="margin:0;">
        <select class="select" v-model="statusFilter" style="width:180px;">
          <option value="">全部状态</option>
          <option v-for="(meta, key) in statusOptions" :key="key" :value="key">{{ meta.label }}</option>
        </select>
      </div>
    </div>

    <div class="card tight">
      <div v-if="loading" class="loading">正在加载记录</div>
      <div v-else-if="!filtered.length" class="empty">
        <span class="e-mark">录</span>
        暂无符合条件的记录
      </div>
      <div class="table-wrap" v-else>
        <table class="tbl">
          <thead>
            <tr>
              <th>课程名称</th>
              <th>课程代码</th>
              <th>学年 / 学期</th>
              <th>状态</th>
              <th>创建时间</th>
              <th style="width:140px;">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in filtered" :key="r.id">
              <td>
                <div class="cell-strong">{{ r.course_name }}</div>
                <div class="cell-muted">{{ r.title }}</div>
              </td>
              <td><span class="cell-code">{{ r.course_code }}</span></td>
              <td>{{ r.academic_year }} · {{ r.term }}</td>
              <td><span class="badge" :class="statusMeta(r.status).cls">{{ statusMeta(r.status).label }}</span></td>
              <td class="cell-muted">{{ fmtTime(r.created_at) }}</td>
              <td>
                <button class="btn btn-ghost btn-sm" @click="$router.push('/records/' + r.id)">查看时间线</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>`,
  data: function () {
    return {
      loading: true,
      reports: [],
      statusFilter: '',
      statusOptions: window.STATUS_META
    };
  },
  computed: {
    filtered: function () {
      var f = this.statusFilter;
      if (!f) return this.reports;
      return this.reports.filter(function (r) { return r.status === f; });
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
    fmtTime: window.fmtTime
  }
};
