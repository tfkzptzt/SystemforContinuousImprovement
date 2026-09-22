/* ============================================================
 * views/record-detail.js —— 完整记录：报告信息 / 措施+逐条达成 / 结论 / 时间线
 * ============================================================ */
window.VIEWS.RecordDetail = {
  name: 'RecordDetail',
  template: `
  <div class="page" style="max-width:920px;">
    <div class="page-head">
      <div>
        <h1 class="page-title">持续改进记录</h1>
        <p class="page-sub" v-if="report.course_name">
          {{ report.course_name }}（{{ report.course_code }}） · {{ report.academic_year }} · {{ report.term }}
        </p>
      </div>
      <div style="display:flex;gap:10px;align-items:center;">
        <span class="badge" :class="statusMeta(report.status).cls" v-if="report.status">
          {{ statusMeta(report.status).label }}
        </span>
        <button class="btn btn-ghost btn-sm" @click="goBack">← 返回</button>
      </div>
    </div>

    <div v-if="loading" class="loading">正在加载记录</div>

    <template v-else>
      <!-- 最终结论（来自 reports.conclusion） -->
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
          <div class="info-item"><div class="k">报告标题</div><div class="v">{{ report.title || '—' }}</div></div>
          <div class="info-item"><div class="k">课程名称</div><div class="v">{{ report.course_name || '—' }}</div></div>
          <div class="info-item"><div class="k">课程代码</div><div class="v">{{ report.course_code || '—' }}</div></div>
          <div class="info-item"><div class="k">学年 / 学期</div><div class="v">{{ report.academic_year }} · {{ report.term }}</div></div>
          <div class="info-item"><div class="k">提交教师</div><div class="v">{{ report.teacher_name || '—' }}</div></div>
          <div class="info-item"><div class="k">当前状态</div>
            <div class="v"><span class="badge" :class="statusMeta(report.status).cls">{{ statusMeta(report.status).label }}</span></div>
          </div>
          <div class="info-item"><div class="k">创建时间</div><div class="v">{{ fmtTime(report.created_at) }}</div></div>
          <div class="info-item"><div class="k">最近更新</div><div class="v">{{ fmtTime(report.updated_at) }}</div></div>
        </div>

        <!-- 原始报告：仅上传来源且存在文件时展示 -->
        <div class="origin-report" v-if="report.source === 'upload' && report.file_path">
          <div class="or-head">
            <span class="or-name">{{ (report.title || '原始报告') + '.docx' }}</span>
            <div class="or-actions">
              <a class="btn btn-sm btn-primary"
                 :href="'/api/reports/' + $route.params.id + '/download'" download>下载原始报告</a>
              <button class="btn btn-sm btn-outline" type="button"
                      @click="togglePreview">{{ previewOpen ? '收起预览' : '预览报告内容' }}</button>
            </div>
          </div>
          <div v-if="previewOpen" class="or-details">
            <div class="preview-mode-label">
              <span v-if="previewLoading">正在加载文档…</span>
              <span v-else>{{ previewMode === 'docx' ? '文档预览' : '文本预览' }}</span>
            </div>
            <div v-show="previewMode === 'docx'" ref="previewContainer" class="docx-preview-wrapper"></div>
            <pre v-show="previewMode === 'text'" class="report-preview">{{ report.content_text || '（无可预览的文本内容）' }}</pre>
          </div>
        </div>
      </div>

      <!-- 措施 + 逐条达成 -->
      <div class="card">
        <h3 class="card-title">
          <span><span class="idx">贰</span>改进措施与达成情况（{{ measures.length }} 条）</span>
          <a v-if="measures.length" class="btn btn-sm btn-outline"
             :href="'/api/reports/' + $route.params.id + '/measures-download'" download>下载措施文档</a>
        </h3>
        <div v-if="!measures.length" class="cell-muted">暂无措施</div>
        <div class="measure-card" v-for="m in measures" :key="m.id" style="margin-bottom:14px;">
          <div class="m-head">
            <div style="display:flex;align-items:center;gap:10px;">
              <span class="m-seq">{{ m.seq }}</span>
              <b>措施 {{ m.seq }}</b>
            </div>
            <div class="m-meta">
              <span v-if="m.assignee_name">责任人：<b>{{ m.assignee_name }}</b></span>
              <span v-if="m.deadline">截止时间：<b>{{ m.deadline }}</b></span>
              <span class="badge" :class="achievementMeta(m.achievement && m.achievement.status).cls"
                    v-if="m.achievement">
                {{ achievementMeta(m.achievement.status).label }}
              </span>
            </div>
          </div>
          <div class="prose" style="margin-bottom:8px;">{{ m.content }}</div>
          <div class="cell-muted" v-if="m.verify_indicator">验证指标：{{ m.verify_indicator }}</div>

          <!-- 该措施的达成报告 -->
          <div v-if="m.achievement" style="border-top:1px dashed var(--line);padding-top:10px;margin-top:10px;">
            <div class="cell-muted" style="margin-bottom:4px;">
              达成报告
              <span v-if="m.achievement.submitter_name">（提交人：{{ m.achievement.submitter_name }}）</span>
              <span v-if="m.achievement.submitted_at"> · {{ fmtTime(m.achievement.submitted_at) }}</span>
            </div>
            <div class="prose" style="background:var(--gray-soft);border-radius:6px;">{{ m.achievement.content || '（无内容）' }}</div>
          </div>
        </div>
      </div>

      <!-- 退回历史 -->
      <div class="card" v-if="rejections.length">
        <h3 class="card-title"><span><span class="idx">叁</span>退回历史</span></h3>
        <div class="notice notice-red" v-for="(rj, i) in rejections" :key="i" style="margin-bottom:8px;">
          <span class="n-ico">✕</span>
          <div>
            <b>{{ rj.target_type === 'achievement' ? '达成报告' : '改进措施' }}被退回</b>
            <span v-if="rj.target_type === 'achievement' && rj.measure_seq" class="cell-muted">（措施 {{ rj.measure_seq }}）</span>
            <span class="cell-muted">（{{ fmtTime(rj.created_at) }}<template v-if="rj.rejecter_name"> · {{ rj.rejecter_name }}</template>）</span><br>
            {{ rj.reason }}
          </div>
        </div>
      </div>

      <!-- 操作时间线 -->
      <div class="card">
        <h3 class="card-title">
          <span><span class="idx">{{ rejections.length ? '肆' : '叁' }}</span>完整操作时间线（{{ timeline.length }} 条）</span>
          <button class="btn btn-sm btn-outline" type="button"
                  @click="timelineOpen = !timelineOpen">{{ timelineOpen ? '收起' : '展开' }}</button>
        </h3>
        <template v-if="timelineOpen">
          <div v-if="!timeline.length" class="cell-muted">暂无操作记录</div>
          <ul class="timeline" v-else>
            <li v-for="(t, i) in timelineDesc" :key="i">
              <div class="tl-action">{{ t.action }}</div>
              <div class="tl-meta">操作人：{{ t.user_name || t.operator_name || '系统' }} · {{ fmtTime(t.created_at) }}</div>
              <div class="tl-detail" v-if="detailText(t.detail)">{{ detailText(t.detail) }}</div>
            </li>
          </ul>
        </template>
      </div>
    </template>
  </div>`,
  data: function () {
    return {
      loading: true,
      previewOpen: false,
      timelineOpen: false,
      previewMode: 'text',     // 'docx' | 'text'
      previewLoading: false,
      report: {},
      measures: [],
      rejections: [],
      timeline: []
    };
  },
  computed: {
    timelineDesc: function () {
      return this.timeline.slice().reverse();
    }
  },
  created: function () { this.load(); },
  methods: {
    statusMeta: window.statusMeta,
    achievementMeta: window.achievementMeta,
    fmtTime: window.fmtTime,
    async load() {
      this.loading = true;
      try {
        var detail = await window.API.get('/api/reports/' + this.$route.params.id);
        this.report = window.reportOf(detail);
        // 将 conclusion/concluded_at 合入 report 对象
        if (detail.conclusion !== undefined) this.report.conclusion = detail.conclusion;
        if (detail.concluded_at !== undefined) this.report.concluded_at = detail.concluded_at;
        this.measures = detail.measures || [];
        this.rejections = detail.rejections || [];
        this.timeline = detail.timeline || [];
      } catch (e) {
        window.toast(e.message, 'error');
      } finally {
        this.loading = false;
      }
    },
    detailText: function (d) {
      if (!d || typeof d !== 'object') return '';
      var parts = [];
      Object.keys(d).forEach(function (k) {
        if (k === 'report_id') return;
        var v = d[k];
        if (v === null || v === undefined) return;
        if (typeof v === 'object') v = JSON.stringify(v);
        parts.push(k + ': ' + v);
      });
      return parts.join('　|　');
    },
    goBack: function () {
      if (window.history.length > 1) this.$router.back();
      else {
        var u = window.AppUser;
        if (u && u.is_admin) this.$router.push('/admin/users');
        else if (u && !u.is_teacher && u.is_leader) this.$router.push('/leader/dashboard');
        else this.$router.push('/teacher/dashboard');
      }
    },
    /* 切换预览：优先调用 docx-preview 渲染，库不可用 / 拉取失败 / 非上传
     * 来源时 fallback 到纯文本预览。每次重新展开都重新拉取，
     * 以保证后端权限变更及时生效。
     */
    togglePreview: async function () {
      if (this.previewOpen) {
        this.previewOpen = false;
        return;
      }
      this.previewOpen = true;
      this.previewMode = 'text';

      // 非上传来源或缺少文件路径 → 直接文本预览
      if (this.report.source !== 'upload' || !this.report.file_path) return;
      // docx-preview 未加载（CDN/本地资源失败）→ fallback 文本预览
      if (!window.docx || typeof window.docx.renderAsync !== 'function') {
        if (window.console && console.warn) console.warn('[record-detail] docx-preview 未加载，回退到文本预览');
        return;
      }

      this.previewLoading = true;
      // 先切到 docx 模式，让容器在 nextTick 后可见（避免 display:none 影响布局计算）
      this.previewMode = 'docx';
      try {
        const resp = await fetch('/api/reports/' + this.$route.params.id + '/file', {
          credentials: 'same-origin'
        });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const blob = await resp.blob();
        await this.$nextTick();
        const container = this.$refs.previewContainer;
        if (!container) throw new Error('预览容器未就绪');
        await window.docx.renderAsync(blob, container, null, {
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: true,
          ignoreFonts: false,
          breakPages: true,
          renderHeaders: false,
          renderFooters: false
        });
      } catch (e) {
        if (window.console && console.warn) console.warn('[record-detail] docx 预览失败，回退到文本：', e);
        this.previewMode = 'text';
      } finally {
        this.previewLoading = false;
      }
    }
  }
};
