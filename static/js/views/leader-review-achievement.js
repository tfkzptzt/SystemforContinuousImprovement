/* ============================================================
 * views/leader-review-achievement.js —— 达成报告审批（按报告聚合）
 * 逐措施审核通过/打回 + 全部通过后整体定级
 * ============================================================ */
window.VIEWS.LeaderReviewAchievement = {
  name: 'LeaderReviewAchievement',
  template: `
  <div class="page" style="max-width:920px;">
    <div class="page-head">
      <div>
        <h1 class="page-title">达成报告审批</h1>
        <p class="page-sub" v-if="report.course_name">
          {{ report.course_name }}（{{ report.course_code }}） · {{ report.academic_year }} · {{ report.term }}
          · 提交教师：{{ report.teacher_name }}
        </p>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <span class="badge" :class="statusMeta(report.status).cls" v-if="report.status">
          {{ statusMeta(report.status).label }}
        </span>
        <button class="btn btn-ghost btn-sm" @click="$router.push('/leader/dashboard')">← 返回</button>
      </div>
    </div>

    <div v-if="loading" class="loading">正在加载报告详情</div>

    <template v-else>
      <!-- 已定级提示 -->
      <div class="conclusion-banner" v-if="report.conclusion" style="margin-bottom:18px;">
        <div class="c-seal">定</div>
        <div>
          <div class="c-title">最终结论：{{ report.conclusion }}</div>
          <div class="c-sub" v-if="report.concluded_at">定级时间：{{ fmtTime(report.concluded_at) }}</div>
        </div>
      </div>

      <!-- 报告信息 -->
      <div class="card">
        <h3 class="card-title"><span><span class="idx">壹</span>报告信息</span></h3>
        <div class="info-grid">
          <div class="info-item"><div class="k">报告标题</div><div class="v">{{ report.title }}</div></div>
          <div class="info-item"><div class="k">课程</div><div class="v">{{ report.course_name }}</div></div>
          <div class="info-item"><div class="k">学年 / 学期</div><div class="v">{{ report.academic_year }} · {{ report.term }}</div></div>
          <div class="info-item"><div class="k">提交教师</div><div class="v">{{ report.teacher_name }}</div></div>
          <div class="info-item"><div class="k">创建时间</div><div class="v">{{ fmtTime(report.created_at) }}</div></div>
          <div class="info-item"><div class="k">措施总数</div><div class="v">{{ measures.length }} 条</div></div>
        </div>
      </div>

      <!-- 逐措施达成审核 -->
      <div class="card">
        <h3 class="card-title">
          <span><span class="idx">贰</span>措施达成审核</span>
          <span class="badge badge-teal" style="font-size:12px;">
            已通过 {{ approvedCount }}/{{ measures.length }}
          </span>
        </h3>
        <div v-if="!measures.length" class="cell-muted">暂无措施数据</div>
        <div class="measure-card" v-for="m in measures" :key="m.id" style="margin-bottom:14px;">
          <div class="m-head">
            <div style="display:flex;align-items:center;gap:10px;">
              <span class="m-seq">{{ m.seq }}</span>
              <b>措施 {{ m.seq }}</b>
            </div>
            <div class="m-meta">
              <span v-if="m.assignee_name">责任人：<b>{{ m.assignee_name }}</b></span>
              <span v-if="m.deadline">截止：<b>{{ m.deadline }}</b></span>
              <span class="badge" :class="achievementMeta(m.achievement && m.achievement.status).cls">
                {{ achievementMeta(m.achievement && m.achievement.status).label }}
              </span>
            </div>
          </div>
          <div class="prose" style="margin-bottom:8px;">{{ m.content }}</div>
          <div class="cell-muted" v-if="m.verify_indicator" style="margin-bottom:10px;">验证指标：{{ m.verify_indicator }}</div>

          <!-- 达成报告内容 -->
          <div v-if="m.achievement" style="border-top:1px dashed var(--line);padding-top:10px;margin-top:6px;">
            <div class="cell-muted" style="margin-bottom:4px;">
              达成报告
              <span v-if="m.achievement.submitter_name">（提交人：{{ m.achievement.submitter_name }}）</span>
              <span v-if="m.achievement.submitted_at"> · {{ fmtTime(m.achievement.submitted_at) }}</span>
            </div>
            <div class="prose" style="background:var(--gray-soft);border-radius:6px;">{{ m.achievement.content || '（无内容）' }}</div>
            <!-- 打回原因 -->
            <div class="notice notice-red" v-if="m.achievement.status === 'returned' && m.achievement.returned_reason" style="margin-top:8px;">
              <span class="n-ico">✕</span>
              <span>打回原因：{{ m.achievement.returned_reason }}</span>
            </div>
            <!-- 审核操作：仅 submitted 状态可操作，且报告未定级 -->
            <div class="row-actions" style="margin-top:10px;" v-if="m.achievement.status === 'submitted' && !report.conclusion">
              <button class="btn btn-primary btn-sm" @click="approveAchievement(m)" :disabled="saving">通过</button>
              <button class="btn btn-danger btn-sm" @click="openReject(m)" :disabled="saving">打回</button>
            </div>
          </div>
          <div v-else class="cell-muted" style="border-top:1px dashed var(--line);padding-top:10px;margin-top:6px;">
            教师尚未提交达成报告
          </div>
        </div>
      </div>

      <!-- 整体定级 -->
      <div class="card" v-if="!report.conclusion">
        <h3 class="card-title"><span><span class="idx">叁</span>整体定级</span></h3>
        <div v-if="!allApproved" class="notice notice-amber" style="margin-bottom:14px;">
          <span class="n-ico">⚠</span>
          <span>仍有 <b>{{ measures.length - approvedCount }}</b> 条措施的达成报告未通过审批，全部通过后方可定级。</span>
        </div>
        <div class="field">
          <label class="field-label">达成定级（四选一）<span class="req">*</span></label>
          <div class="radio-cards" v-if="conclusions.length">
            <label class="radio-card" v-for="opt in conclusions" :key="opt"
                   :class="{ checked: finalResult === opt }">
              <input type="radio" :value="opt" v-model="finalResult" :disabled="!allApproved">
              <span class="rc-name">{{ opt }}</span>
            </label>
          </div>
          <p class="form-hint" v-if="!conclusions.length" style="color:var(--red);">
            结论选项加载失败，请刷新页面重试。
          </p>
        </div>
        <div class="btn-row" style="display:flex;gap:12px;justify-content:flex-end;">
          <button class="btn btn-primary" @click="conclude" :disabled="saving || !allApproved || !finalResult"
                  style="padding:8px 26px;">
            {{ saving ? '提交中…' : '确认定级' }}
          </button>
        </div>
      </div>
    </template>

    <!-- 打回弹窗 -->
    <div class="modal-mask" v-if="rejectOpen" @click.self="rejectOpen = false">
      <div class="modal">
        <h3 class="modal-title">打回达成报告</h3>
        <p class="cell-muted" style="margin-bottom:12px;" v-if="rejectTarget">
          措施 {{ rejectTarget.seq }}：{{ rejectTarget.content ? rejectTarget.content.slice(0, 60) : '' }}…
        </p>
        <div class="field" style="margin-bottom:0;">
          <label class="field-label">打回原因<span class="req">*</span></label>
          <textarea class="textarea" v-model="rejectReasonInput" rows="4"
                    placeholder="请说明打回原因，责任人将据此修改达成报告"></textarea>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" @click="rejectOpen = false">取消</button>
          <button class="btn btn-danger" @click="doReject" :disabled="saving">确认打回</button>
        </div>
      </div>
    </div>

    <!-- 定级成功提示 -->
    <div class="modal-mask" v-if="doneOpen">
      <div class="modal" style="text-align:center;">
        <div style="font-size:44px;">🏁</div>
        <h3 class="modal-title" style="margin-top:8px;">定级完成</h3>
        <p style="color:var(--ink-soft);line-height:1.8;">
          该报告的持续改进流程已结束，最终结论为
          <b style="color:var(--green);">「{{ doneResult }}」</b>，
          系统已生成完整的改进记录，可在「历史查询」中追溯。
        </p>
        <div class="modal-foot" style="justify-content:center;">
          <button class="btn btn-primary" @click="$router.push('/leader/dashboard')">返回工作台</button>
          <button class="btn btn-ghost" @click="$router.push('/records/' + report.id)">查看记录</button>
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
      conclusions: [],
      finalResult: '',
      rejectOpen: false,
      rejectTarget: null,
      rejectReasonInput: '',
      doneOpen: false,
      doneResult: ''
    };
  },
  computed: {
    approvedCount: function () {
      return this.measures.filter(function (m) {
        return m.achievement && m.achievement.status === 'approved';
      }).length;
    },
    allApproved: function () {
      return this.measures.length > 0 && this.approvedCount === this.measures.length;
    }
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
      // 保留 conclusion/concluded_at 到 report 对象
      if (detail.conclusion !== undefined) this.report.conclusion = detail.conclusion;
      if (detail.concluded_at !== undefined) this.report.concluded_at = detail.concluded_at;
      this.measures = detail.measures || [];
      var concl = results[1].conclusions;
      if (concl && concl.length) {
        this.conclusions = concl;
      } else {
        window.toast('结论选项加载失败，请刷新页面重试', 'error');
      }
    } catch (e) {
      window.toast(e.message, 'error');
    } finally {
      this.loading = false;
    }
  },
  methods: {
    statusMeta: window.statusMeta,
    achievementMeta: window.achievementMeta,
    fmtTime: window.fmtTime,
    async approveAchievement(m) {
      if (!m.achievement) return;
      this.saving = true;
      try {
        await window.API.post('/api/achievements/' + m.achievement.id + '/approve');
        window.toast('措施 ' + m.seq + ' 达成报告已通过', 'success');
        await this.reload();
      } catch (e) {
        window.toast(e.message, 'error');
      } finally {
        this.saving = false;
      }
    },
    openReject: function (m) {
      this.rejectTarget = m;
      this.rejectReasonInput = '';
      this.rejectOpen = true;
    },
    async doReject() {
      if (!String(this.rejectReasonInput || '').trim()) {
        window.toast('请填写打回原因', 'error');
        return;
      }
      if (!this.rejectTarget || !this.rejectTarget.achievement) return;
      this.saving = true;
      try {
        await window.API.post('/api/achievements/' + this.rejectTarget.achievement.id + '/reject', {
          reason: String(this.rejectReasonInput).trim()
        });
        window.toast('已打回，责任人将收到打回原因', 'success');
        this.rejectOpen = false;
        await this.reload();
      } catch (e) {
        window.toast(e.message, 'error');
      } finally {
        this.saving = false;
      }
    },
    async conclude() {
      if (!this.finalResult) {
        window.toast('请选择达成定级', 'error');
        return;
      }
      this.saving = true;
      try {
        await window.API.post('/api/reports/' + this.report.id + '/conclude', {
          final_result: this.finalResult
        });
        this.doneResult = this.finalResult;
        this.doneOpen = true;
      } catch (e) {
        window.toast(e.message, 'error');
      } finally {
        this.saving = false;
      }
    },
    async reload() {
      try {
        var detail = await window.API.get('/api/reports/' + this.report.id);
        this.report = window.reportOf(detail);
        if (detail.conclusion !== undefined) this.report.conclusion = detail.conclusion;
        if (detail.concluded_at !== undefined) this.report.concluded_at = detail.concluded_at;
        this.measures = detail.measures || [];
      } catch (e) { /* 刷新失败不阻断 */ }
    }
  }
};
