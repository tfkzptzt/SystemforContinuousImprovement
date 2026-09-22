/* ============================================================
 * views/leader-approve-measures.js —— 负责人审批措施：逐条只读 + 指派责任人
 * ============================================================ */
window.VIEWS.LeaderApproveMeasures = {
  name: 'LeaderApproveMeasures',
  template: `
  <div class="page" style="max-width:880px;">
    <div class="page-head">
      <div>
        <h1 class="page-title">审批改进措施</h1>
        <p class="page-sub" v-if="report.course_name">
          {{ report.course_name }}（{{ report.course_code }}） · {{ report.academic_year }} · {{ report.term }}
          · 提交教师：{{ report.teacher_name }}
        </p>
      </div>
      <span class="badge badge-amber" v-if="report.status">待审批</span>
    </div>

    <div v-if="loading" class="loading">正在加载待审批措施</div>

    <template v-else>
      <div class="notice notice-blue">
        <span class="n-ico">✦</span>
        <span>请逐条审阅教师提交的改进措施，并为每条措施指派责任人、设置执行截止时间。全部填写完整后方可通过审批。</span>
      </div>

      <div v-if="!measures.length" class="empty">
        <span class="e-mark">空</span>该报告暂无待审批措施
      </div>

      <div class="measure-card" v-for="(m, idx) in measures" :key="m.id">
        <div class="m-head">
          <div style="display:flex;align-items:center;gap:10px;">
            <span class="m-seq">{{ m.seq || (idx + 1) }}</span>
            <b style="font-family:var(--serif);letter-spacing:1px;">改进措施 第 {{ idx + 1 }} 条</b>
          </div>
        </div>
        <div class="prose" style="margin-bottom:10px;">{{ m.content }}</div>
        <div class="m-meta" v-if="m.verify_indicator" style="margin-bottom:12px;">
          <span>次年验证指标：<b>{{ m.verify_indicator }}</b></span>
        </div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;">
          <div class="field" style="margin:0;max-width:300px;flex:1;min-width:200px;">
            <label class="field-label">责任人<span class="req">*</span></label>
            <select class="select" v-model="assign[m.id]">
              <option :value="null" disabled>请选择责任人</option>
              <option v-for="t in teachers" :key="t.id" :value="t.id">{{ t.real_name }}</option>
            </select>
          </div>
          <div class="field" style="margin:0;max-width:300px;flex:1;min-width:200px;">
            <label class="field-label">执行截止时间<span class="req">*</span></label>
            <input class="input" type="date" v-model="deadlines[m.id]">
          </div>
        </div>
      </div>

      <div class="btn-row" style="display:flex;gap:12px;justify-content:flex-end;margin-top:6px;" v-if="measures.length">
        <button class="btn btn-danger" @click="openReject">退回</button>
        <button class="btn btn-primary" @click="approve" :disabled="saving" style="padding:8px 26px;">
          {{ saving ? '提交中…' : '通过并分配责任人' }}
        </button>
      </div>
    </template>

    <!-- 退回弹窗 -->
    <div class="modal-mask" v-if="rejectOpen" @click.self="rejectOpen = false">
      <div class="modal">
        <h3 class="modal-title">退回措施</h3>
        <div class="field" style="margin-bottom:0;">
          <label class="field-label">退回原因<span class="req">*</span></label>
          <textarea class="textarea" v-model="rejectReason" rows="4"
                    placeholder="请说明退回原因，教师将据此修改措施后重新提交"></textarea>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" @click="rejectOpen = false">取消</button>
          <button class="btn btn-accent" @click="doReject" :disabled="saving">确认退回</button>
        </div>
      </div>
    </div>
  </div>`,
  data: function () {
    return {
      loading: true,
      saving: false,
      report: {},
      measures: [],
      teachers: [],
      assign: {},
      deadlines: {},
      rejectOpen: false,
      rejectReason: ''
    };
  },
  created: async function () {
    var id = this.$route.params.id;
    try {
      var results = await Promise.all([
        window.API.get('/api/reports/' + id),
        window.API.get('/api/dictionaries')
      ]);
      var detail = results[0];
      this.report = window.reportOf(detail);
      this.measures = detail.measures || [];
      this.teachers = results[1].teachers || [];
      var def = this.defaultTeacher();
      var assign = {};
      var deadlines = {};
      this.measures.forEach(function (m, i) {
        // 轮流预填默认责任人（如吴老师、李老师），负责人可修改；截止时间默认为空，由负责人逐条手动设置
        assign[m.id] = def.length ? def[i % def.length].id : (this.teachers[0] ? this.teachers[0].id : null);
        deadlines[m.id] = '';
      }, this);
      this.assign = assign;
      this.deadlines = deadlines;
    } catch (e) {
      window.toast(e.message, 'error');
    } finally {
      this.loading = false;
    }
  },
  methods: {
    defaultTeacher: function () {
      var order = ['吴', '李', '王', '张'];
      var picked = [];
      order.forEach(function (surname) {
        var t = this.teachers.find(function (x) {
          return (x.real_name || '').indexOf(surname) === 0;
        });
        if (t) picked.push(t);
      }, this);
      return picked.length ? picked : this.teachers.slice(0, 2);
    },
    async approve() {
      for (var i = 0; i < this.measures.length; i++) {
        var m = this.measures[i];
        if (!this.assign[m.id]) {
          window.toast('第 ' + (i + 1) + ' 条措施尚未选择责任人', 'error');
          return;
        }
        if (!this.deadlines[m.id]) {
          window.toast('请为每条措施设置执行截止时间（第 ' + (i + 1) + ' 条未填写）', 'error');
          return;
        }
      }
      if (!window.confirm('确认通过全部措施并指派责任人？')) {
        return;
      }
      this.saving = true;
      try {
        var assignments = this.measures.map(function (m) {
          return { measure_id: m.id, assignee_id: this.assign[m.id] };
        }, this);
        var deadlines = {};
        this.measures.forEach(function (m) {
          deadlines[m.id] = this.deadlines[m.id];
        }, this);
        var res = await window.API.post('/api/reports/' + this.report.id + '/approve', {
          assignments: assignments,
          deadlines: deadlines
        });
        var dl = (res && res.deadlines && res.deadlines[this.measures[0].id]) || '';
        window.toast('审批通过，已指派责任人' + (dl ? '（执行截止 ' + dl + ' 等）' : ''), 'success');
        this.$router.push('/leader/dashboard');
      } catch (e) {
        window.toast(e.message, 'error');
      } finally {
        this.saving = false;
      }
    },
    openReject: function () {
      this.rejectReason = '';
      this.rejectOpen = true;
    },
    async doReject() {
      if (!String(this.rejectReason || '').trim()) {
        window.toast('请填写退回原因', 'error');
        return;
      }
      this.saving = true;
      try {
        await window.API.post('/api/reports/' + this.report.id + '/reject', {
          reason: String(this.rejectReason).trim()
        });
        window.toast('已退回，教师将收到退回原因', 'success');
        this.rejectOpen = false;
        this.$router.push('/leader/dashboard');
      } catch (e) {
        window.toast(e.message, 'error');
      } finally {
        this.saving = false;
      }
    }
  }
};
