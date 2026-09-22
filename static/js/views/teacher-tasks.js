/* ============================================================
 * views/teacher-tasks.js —— 教师端「我的任务」：分配给我的措施列表
 * ============================================================ */
window.VIEWS.TeacherTasks = {
  name: 'TeacherTasks',
  template: `
  <div class="page">
    <div class="page-head">
      <div>
        <h1 class="page-title">我的任务</h1>
        <p class="page-sub">分配给我的改进措施，逐条填写达成报告</p>
      </div>
      <router-link class="btn btn-ghost" to="/teacher/dashboard">← 返回仪表盘</router-link>
    </div>

    <!-- 统计摘要 -->
    <div class="grid-2" style="margin-bottom:18px;" v-if="!loading && tasks.length">
      <div class="stat-card" style="--sc: var(--teal);">
        <div class="stat-num">{{ counts.pending }}</div>
        <div>
          <div class="stat-label">待执行</div>
          <div class="stat-desc">尚未填写或等待审核</div>
        </div>
      </div>
      <div class="stat-card" style="--sc: var(--accent);">
        <div class="stat-num">{{ counts.returned }}</div>
        <div>
          <div class="stat-label">被打回</div>
          <div class="stat-desc">需要修改后重新提交</div>
        </div>
      </div>
    </div>

    <!-- 任务列表 -->
    <div class="card tight">
      <div v-if="loading" class="loading">正在加载任务列表</div>
      <div v-else-if="!tasks.length" class="empty">
        <span class="e-mark">清</span>暂无分配给我的措施任务
      </div>
      <div class="table-wrap tbl-cards" v-else>
        <table class="tbl">
          <thead>
            <tr>
              <th style="width:44px;">序号</th>
              <th>措施内容</th>
              <th>所属报告 / 课程</th>
              <th style="width:110px;">截止日期</th>
              <th style="width:90px;">达成状态</th>
              <th style="width:130px;">操作</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="t in tasks" :key="t.measure_id">
              <tr>
                <td data-label="序号">
                  <span class="m-seq" style="width:24px;height:24px;font-size:12px;">{{ t.seq }}</span>
                </td>
                <td data-label="措施内容">
                  <div>{{ t.content }}</div>
                  <div class="cell-muted" v-if="t.verify_indicator">验证指标：{{ t.verify_indicator }}</div>
                </td>
                <td data-label="所属报告">
                  <div class="cell-strong">{{ t.report_title }}</div>
                  <div class="cell-muted">{{ t.course_name }} · {{ t.academic_year }} · {{ t.term }}</div>
                </td>
                <td data-label="截止日期">
                  {{ t.deadline || '—' }}
                  <span v-if="t.deadline && !notExpired(t.deadline)" class="badge badge-red" style="margin-left:4px;">已过期</span>
                </td>
                <td data-label="达成状态">
                  <span class="badge" :class="achievementMeta(t.achievement_status).cls">
                    {{ achievementMeta(t.achievement_status).label }}
                  </span>
                </td>
                <td data-label="操作">
                  <div class="row-actions">
                    <button v-if="t.achievement_status === 'approved'" class="btn btn-ghost btn-sm"
                            @click="$router.push('/teacher/execute/' + t.measure_id)">查看</button>
                    <button v-else class="btn btn-primary btn-sm"
                            @click="$router.push('/teacher/execute/' + t.measure_id)">
                      {{ t.achievement_status === 'returned' ? '修改重提' : (t.achievement_status === 'submitted' ? '查看' : '填写达成') }}
                    </button>
                  </div>
                </td>
              </tr>
              <!-- 被打回原因 -->
              <tr v-if="t.achievement_status === 'returned' && t.returned_reason" class="row-sub">
                <td colspan="6">
                  <div class="notice notice-red" style="margin:6px 0;">
                    <span class="n-ico">✕</span>
                    <span>打回原因：{{ t.returned_reason }}</span>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>
  </div>`,
  data: function () {
    return {
      loading: true,
      tasks: []
    };
  },
  computed: {
    counts: function () {
      var pending = 0, returned = 0;
      this.tasks.forEach(function (t) {
        if (t.achievement_status === 'returned') returned++;
        else if (!t.achievement_status) pending++;
      });
      return { pending: pending, returned: returned };
    }
  },
  created: function () { this.load(); },
  methods: {
    achievementMeta: window.achievementMeta,
    notExpired: window.notExpired,
    async load() {
      this.loading = true;
      try {
        this.tasks = await window.API.get('/api/measures/mine');
      } catch (e) {
        window.toast(e.message, 'error');
      } finally {
        this.loading = false;
      }
    }
  }
};
