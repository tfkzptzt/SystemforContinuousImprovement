/* ============================================================
 * views/leader-dashboard.js —— 专业负责人工作台：待办统计 + 两个待办列表
 * ============================================================ */
window.VIEWS.LeaderDashboard = {
  name: 'LeaderDashboard',
  template: `
  <div class="page">
    <div class="page-head">
      <div>
        <h1 class="page-title">负责人工作台</h1>
        <p class="page-sub">待审批事项总览，点击进入对应审批流程</p>
      </div>
    </div>

    <div class="grid-2" style="margin-bottom:20px;">
      <div class="stat-card" style="--sc: var(--amber);">
        <div class="stat-num">{{ pendingMeasures.length }}</div>
        <div>
          <div class="stat-label">待审批改进措施</div>
          <div class="stat-desc">教师已提交、等待审批并指派责任人</div>
        </div>
      </div>
      <div class="stat-card" style="--sc: var(--teal);">
        <div class="stat-num">{{ pendingAchievements.length }}</div>
        <div>
          <div class="stat-label">待审达成报告</div>
          <div class="stat-desc">教师已提交达成情况、等待审核定级</div>
        </div>
      </div>
    </div>

    <div v-if="loading" class="loading">正在加载待办事项</div>

    <div class="grid-2" v-else>
      <div class="card tight">
        <h3 class="card-title"><span><span class="idx">壹</span>待审批措施</span></h3>
        <div v-if="!pendingMeasures.length" class="empty" style="padding:30px;">
          <span class="e-mark">清</span>暂无待审批措施
        </div>
        <div class="table-wrap" v-else>
        <table class="tbl">
          <thead>
            <tr>
              <th>课程 / 报告</th>
              <th>提交教师</th>
              <th style="width:110px;">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in pendingMeasures" :key="r.id">
              <td>
                <div class="cell-strong">{{ r.course_name }}</div>
                <div class="cell-muted">{{ r.academic_year }} · {{ r.term }} · {{ r.title }}</div>
              </td>
              <td>{{ r.teacher_name }}</td>
              <td>
                <button class="btn btn-primary btn-sm" @click="$router.push('/leader/approve/' + r.id)">去审批</button>
              </td>
            </tr>
          </tbody>
        </table>
        </div>
      </div>

      <div class="card tight">
        <h3 class="card-title"><span><span class="idx">贰</span>待审达成报告</span></h3>
        <div v-if="!pendingAchievements.length" class="empty" style="padding:30px;">
          <span class="e-mark">清</span>暂无待审达成报告
        </div>
        <div class="table-wrap" v-else>
        <table class="tbl">
          <thead>
            <tr>
              <th>课程 / 报告</th>
              <th>提交教师</th>
              <th style="width:100px;">达成进度</th>
              <th style="width:110px;">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in pendingAchievements" :key="r.id">
              <td>
                <div class="cell-strong">{{ r.course_name }}</div>
                <div class="cell-muted">{{ r.academic_year }} · {{ r.term }} · {{ r.title }}</div>
              </td>
              <td>{{ r.teacher_name }}</td>
              <td>
                <span class="badge badge-teal">{{ r.approved_count || 0 }}/{{ r.total_measures || 0 }}</span>
                <span v-if="r.ready_to_conclude" class="badge badge-green" style="margin-left:4px;">可定级</span>
              </td>
              <td>
                <button class="btn btn-primary btn-sm" @click="$router.push('/leader/review/' + r.id)">
                  {{ r.ready_to_conclude ? '去定级' : '去审核' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        </div>
      </div>
    </div>
  </div>`,
  data: function () {
    return {
      loading: true,
      pendingMeasures: [],
      pendingAchievements: []
    };
  },
  created: async function () {
    try {
      var data = await window.API.get('/api/leader/pending');
      this.pendingMeasures = data.pending_measures || [];
      this.pendingAchievements = data.pending_achievements || [];
    } catch (e) {
      window.toast(e.message, 'error');
    } finally {
      this.loading = false;
    }
  }
};
