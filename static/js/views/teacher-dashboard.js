/* ============================================================
 * views/teacher-dashboard.js —— 教师端仪表盘：我的任务卡片 + 报告列表 + 删除
 * ============================================================ */
window.VIEWS.TeacherDashboard = {
  name: 'TeacherDashboard',
  template: `
  <div class="page">
    <div class="page-head">
      <div>
        <h1 class="page-title">我的报告</h1>
        <p class="page-sub">课程考核报告的持续改进全流程跟踪</p>
      </div>
      <router-link class="btn btn-accent" to="/teacher/reports/new">＋ 新建报告</router-link>
    </div>

    <!-- 我的任务卡片 -->
    <div class="grid-2" style="margin-bottom:18px;" v-if="taskSummary.total > 0">
      <div class="stat-card" style="--sc: var(--teal);">
        <div class="stat-num">{{ taskSummary.pending }}</div>
        <div>
          <div class="stat-label">待执行任务</div>
          <div class="stat-desc">分配给我的措施中尚未填写或待审核</div>
        </div>
      </div>
      <div class="stat-card" style="--sc: var(--accent);">
        <div class="stat-num">{{ taskSummary.returned }}</div>
        <div>
          <div class="stat-label">被打回</div>
          <div class="stat-desc">需要修改后重新提交的达成报告</div>
        </div>
      </div>
      <div style="grid-column:1/-1;">
        <router-link class="btn btn-primary" to="/teacher/tasks" style="width:100%;text-align:center;">
          前往「我的任务」查看全部 {{ taskSummary.total }} 条 →
        </router-link>
      </div>
    </div>
    <div class="card tight" style="margin-bottom:18px;" v-else-if="!taskLoading">
      <div class="empty" style="padding:18px;">
        <span class="e-mark">务</span>
        暂无分配给我的措施任务
        <router-link to="/teacher/tasks" style="margin-left:8px;">查看任务页 →</router-link>
      </div>
    </div>

    <!-- 报告列表 -->
    <div class="card tight">
      <div v-if="loading" class="loading">正在加载报告列表</div>
      <div v-else-if="!reports.length" class="empty">
        <span class="e-mark">笈</span>
        暂无报告，点击右上角「新建报告」上传第一份课程考核报告
      </div>
      <div class="table-wrap tbl-cards" v-else>
        <table class="tbl">
          <thead>
            <tr>
              <th>课程名称</th>
              <th>课程代码</th>
              <th>学年 / 学期</th>
              <th>状态</th>
              <th>创建时间</th>
              <th style="width:340px;">操作</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="r in reports" :key="r.id">
              <tr>
                <td data-label="课程名称">
                  <div class="cell-strong">{{ r.course_name }}</div>
                  <div class="cell-muted">{{ r.title }}</div>
                </td>
                <td data-label="课程代码"><span class="cell-code">{{ r.course_code }}</span></td>
                <td data-label="学年 / 学期">{{ r.academic_year }} · {{ r.term }}</td>
                <td data-label="状态"><span class="badge" :class="statusMeta(r.status).cls">{{ statusMeta(r.status).label }}</span></td>
                <td class="cell-muted" data-label="创建时间">{{ fmtTime(r.created_at) }}</td>
                <td data-label="操作">
                  <div class="row-actions">
                    <button v-if="r.status === 'draft'" class="btn btn-primary btn-sm"
                            @click="goMeasures(r)">去生成措施</button>
                    <button v-if="r.status === 'measures_generated' || r.status === 'returned'"
                            class="btn btn-primary btn-sm" @click="goMeasures(r)">编辑措施</button>
                    <button v-if="['submitted','executing','concluded'].indexOf(r.status) >= 0"
                            class="btn btn-ghost btn-sm" @click="$router.push('/records/' + r.id)">查看进度</button>
                    <a v-if="r.source === 'upload'" class="btn btn-sm btn-outline"
                       :href="'/api/reports/' + r.id + '/download'" download title="下载原始报告">下载</a>
                    <button v-if="canDelete(r)" class="btn btn-danger btn-sm"
                            @click="confirmDelete(r)">删除</button>
                    <span v-if="r.status === 'submitted'" class="cell-muted">等待负责人审批…</span>
                  </div>
                  <div v-if="r.status === 'returned' && rejectReasons[r.id]"
                       class="notice notice-red" style="margin:10px 0 0;">
                    <span class="n-ico">✕</span>
                    <span>退回原因：{{ rejectReasons[r.id] }}</span>
                  </div>
                </td>
              </tr>

              <!-- 执行中：展开措施明细（责任人/截止时间/修改截止时间） -->
              <tr v-if="r.status === 'executing' && detailMap[r.id]" class="row-sub">
                <td colspan="6">
                  <div style="padding:4px 6px;">
                    <div v-if="!detailMap[r.id].measures.length" class="cell-muted">暂无措施数据</div>
                    <div class="table-wrap" v-else>
                    <table class="tbl">
                      <thead>
                        <tr>
                          <th style="width:40px;">序号</th>
                          <th>措施内容</th>
                          <th style="width:100px;">责任人</th>
                          <th style="width:250px;">截止时间</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="m in detailMap[r.id].measures" :key="m.id">
                          <td><span class="m-seq" style="width:22px;height:22px;font-size:12px;">{{ m.seq }}</span></td>
                          <td>{{ m.content }}</td>
                          <td>{{ m.assignee_name || '—' }}</td>
                          <td>
                            <div style="display:flex;gap:8px;align-items:center;">
                              <input class="input" style="width:150px;padding:5px 8px;"
                                     type="date" :value="m.deadline || ''"
                                     @change="onDeadlineEdit(r, m, $event)">
                              <span v-if="!notExpired(m.deadline)" class="badge badge-red">已过期</span>
                            </div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                    </div>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 删除确认弹窗 -->
    <div class="modal-mask" v-if="deleteOpen" @click.self="deleteOpen = false">
      <div class="modal modal-danger">
        <h3 class="modal-title danger-title">确认删除报告</h3>
        <p style="line-height:1.8;color:var(--ink-soft);">
          即将删除报告<b>「{{ deleteTarget && deleteTarget.title }}」</b>。<br>
          <span style="color:var(--accent);font-weight:500;">
            此操作不可撤销，将同时删除已生成的措施与上传的文件。
          </span>
        </p>
        <div class="modal-foot">
          <button class="btn btn-ghost" @click="deleteOpen = false">取消</button>
          <button class="btn btn-danger" @click="doDelete" :disabled="deleting">
            {{ deleting ? '正在删除…' : '确认删除' }}
          </button>
        </div>
      </div>
    </div>
  </div>`,
  data: function () {
    return {
      loading: true,
      taskLoading: true,
      reports: [],
      rejectReasons: {},
      detailMap: {},
      taskSummary: { total: 0, pending: 0, returned: 0 },
      deleteOpen: false,
      deleteTarget: null,
      deleting: false
    };
  },
  created: function () { this.load(); this.loadTasks(); },
  methods: {
    statusMeta: window.statusMeta,
    fmtTime: window.fmtTime,
    notExpired: window.notExpired,
    canDelete: function (r) {
      return ['draft', 'measures_generated', 'returned'].indexOf(r.status) >= 0;
    },
    async load() {
      this.loading = true;
      try {
        this.reports = await window.API.get('/api/reports');
        // 已退回的报告：拉取详情以展示退回原因
        this.reports.filter(function (r) { return r.status === 'returned'; })
          .forEach(this.loadRejectReason, this);
        // 执行中：拉取详情以展示措施责任人/截止时间
        this.reports.filter(function (r) { return r.status === 'executing'; })
          .forEach(this.loadDetail, this);
      } catch (e) {
        window.toast(e.message, 'error');
      } finally {
        this.loading = false;
      }
    },
    async loadTasks() {
      this.taskLoading = true;
      try {
        var tasks = await window.API.get('/api/measures/mine');
        var pending = 0, returned = 0;
        tasks.forEach(function (t) {
          if (t.achievement_status === 'returned') returned++;
          else if (!t.achievement_status || t.achievement_status === 'submitted') pending++;
        });
        this.taskSummary = { total: tasks.length, pending: pending, returned: returned };
      } catch (e) {
        this.taskSummary = { total: 0, pending: 0, returned: 0 };
      } finally {
        this.taskLoading = false;
      }
    },
    async loadRejectReason(r) {
      try {
        var detail = await window.API.get('/api/reports/' + r.id);
        var rej = window.latestRejection(detail.rejections, 'measures');
        if (rej) this.rejectReasons[r.id] = rej.reason;
      } catch (e) { /* 单条失败不阻断列表 */ }
    },
    async loadDetail(r) {
      try {
        var detail = await window.API.get('/api/reports/' + r.id);
        this.detailMap[r.id] = { measures: detail.measures || [] };
      } catch (e) { /* 单条失败不阻断列表 */ }
    },
    goMeasures(r) { this.$router.push('/teacher/measures/' + r.id); },
    confirmDelete(r) {
      this.deleteTarget = r;
      this.deleteOpen = true;
    },
    async doDelete() {
      if (!this.deleteTarget) return;
      this.deleting = true;
      try {
        await window.API.del('/api/reports/' + this.deleteTarget.id);
        window.toast('报告已删除', 'success');
        this.deleteOpen = false;
        this.deleteTarget = null;
        this.load();
      } catch (e) {
        window.toast(e.message, 'error');
      } finally {
        this.deleting = false;
      }
    },
    async onDeadlineEdit(r, m, evt) {
      var val = evt.target.value;
      if (!val || val === m.deadline) return;
      try {
        await window.API.patch('/api/measures/' + m.id + '/deadline', { deadline: val });
        m.deadline = val;
        window.toast('截止时间已更新为 ' + val, 'success');
        this.loadDetail(r);
      } catch (e) {
        window.toast(e.message, 'error');
        this.loadDetail(r);
      }
    }
  }
};
