/* ============================================================
 * views/measure-editor.js —— 分条措施编辑（生成 / 编辑 / 提交审批）
 * ============================================================ */
window.VIEWS.MeasureEditor = {
  name: 'MeasureEditor',
  template: `
  <div class="page" style="max-width:860px;">
    <div class="page-head">
      <div>
        <h1 class="page-title">{{ isDraft ? '生成改进措施' : '编辑改进措施' }}</h1>
        <p class="page-sub" v-if="report.course_name">
          {{ report.course_name }}（{{ report.course_code }}） · {{ report.academic_year }} · {{ report.term }}
        </p>
      </div>
      <span class="badge" :class="statusMeta(report.status).cls" v-if="report.status">
        {{ statusMeta(report.status).label }}
      </span>
    </div>

    <div v-if="loading" class="loading">正在加载报告</div>

    <template v-else>
      <!-- 最近一次退回原因 -->
      <div class="notice notice-red" v-if="rejectReason">
        <span class="n-ico">✕</span>
        <div>
          <b>最近一次退回原因</b>（{{ fmtTime(rejectAt) }}）<br>
          {{ rejectReason }}
        </div>
      </div>

      <!-- 生成方式选择：仅草稿且尚未选择时展示 -->
      <div class="gen-chooser" v-if="showChooser">
        <div class="notice notice-blue" style="margin-bottom:16px;">
          <span class="n-ico">✦</span>
          <span>请选择改进措施的产生方式：由系统基于报告正文智能生成草稿，或直接手动逐条填写。两种方式生成后都可再自由增删修改。</span>
        </div>
        <div class="gen-options">
          <button class="gen-opt" type="button" @click="chooseAI">
            <span class="gen-opt-ico">✦</span>
            <span class="gen-opt-title">AI 智能生成</span>
            <span class="gen-opt-desc">系统剖析报告正文中的问题，自动生成改进措施与次年验证指标草稿，您再逐条审阅修改。</span>
          </button>
          <button class="gen-opt" type="button" @click="chooseManual">
            <span class="gen-opt-ico">✎</span>
            <span class="gen-opt-title">手动填写</span>
            <span class="gen-opt-desc">不使用智能生成，由您从空白开始逐条撰写改进措施与次年验证指标。</span>
          </button>
        </div>
      </div>

      <template v-else>
        <div class="notice notice-blue" v-if="genChoice === 'manual'">
          <span class="n-ico">✎</span>
          <span>手动填写模式：请逐条撰写改进措施。如需改用智能生成，可点击右上方按钮。</span>
        </div>
        <div class="btn-row" v-if="canGenerate && !generating" style="justify-content:flex-end;margin-bottom:12px;">
          <button class="btn btn-ghost btn-sm" @click="onGenerate" :disabled="generating">
            {{ measures.length ? '↻ 重新生成' : '✦ AI 智能生成' }}
          </button>
        </div>

        <div v-if="generating" class="loading">正在分析报告、生成改进措施</div>

        <template v-else>
        <div class="measure-card" v-for="(m, idx) in measures" :key="idx">
          <div class="m-head">
            <div style="display:flex;align-items:center;gap:10px;">
              <span class="m-seq">{{ idx + 1 }}</span>
              <b style="font-family:var(--serif);letter-spacing:1px;">改进措施 第 {{ idx + 1 }} 条</b>
            </div>
            <button class="btn btn-danger btn-sm" @click="remove(idx)" :disabled="measures.length <= 1">删除</button>
          </div>
          <div class="field" style="margin-bottom:12px;">
            <label class="field-label">措施内容<span class="req">*</span></label>
            <textarea class="textarea" v-model="m.content"
                      placeholder="请描述具体改进措施，例如：针对期末综合题得分率低的问题，在下一轮教学中增加两次阶段性综合训练…"></textarea>
          </div>
          <div class="field" style="margin-bottom:0;">
            <label class="field-label">次年验证指标</label>
            <textarea class="textarea" v-model="m.verify_indicator" style="min-height:60px;"
                      placeholder="例如：下一学年该课程期末综合题平均分提升至 70 分以上"></textarea>
          </div>
        </div>

        <div v-if="!measures.length" class="empty">
          <span class="e-mark">策</span>
          暂无措施条目，请点击下方按钮新增
        </div>

        <button class="btn btn-ghost btn-block" @click="add"
                style="border-style:dashed;padding:12px;margin-bottom:20px;">
          ＋ 新增一条措施
        </button>

        <div class="btn-row" style="display:flex;gap:12px;justify-content:flex-end;">
          <button class="btn btn-ghost" @click="saveOnly" :disabled="saving">
            {{ saving ? '保存中…' : '仅保存草稿' }}
          </button>
          <button class="btn btn-primary" @click="submitForApproval" :disabled="saving" style="padding:8px 26px;">
            {{ saving ? '提交中…' : '提交专业负责人审批' }}
          </button>
        </div>
      </template>
      </template>
    </template>
  </div>`,
  data: function () {
    return {
      loading: true,
      generating: false,
      saving: false,
      report: {},
      measures: [],
      genChoice: '',
      rejectReason: '',
      rejectAt: ''
    };
  },
  computed: {
    isDraft: function () { return this.report.status === 'draft'; },
    // 与后端 GENERATE_ALLOWED 保持一致：草稿、已生成、被退回均可（重新）生成
    canGenerate: function () {
      return ['draft', 'measures_generated', 'returned'].indexOf(this.report.status) >= 0;
    },
    showChooser: function () {
      return this.isDraft && !this.measures.length && !this.genChoice;
    }
  },
  created: async function () {
    var id = this.$route.params.id;
    try {
      var detail = await window.API.get('/api/reports/' + id);
      this.report = window.reportOf(detail);
      this.measures = (detail.measures || []).map(function (m) {
        return { id: m.id, content: m.content || '', verify_indicator: m.verify_indicator || '' };
      });
      var rej = window.latestRejection(detail.rejections, 'measures');
      if (rej) {
        this.rejectReason = rej.reason;
        this.rejectAt = rej.created_at;
      }
      if (this.report.status === 'draft' && this.measures.length) {
        this.genChoice = 'manual';
      }
    } catch (e) {
      window.toast(e.message, 'error');
    } finally {
      this.loading = false;
    }
  },
  methods: {
    statusMeta: window.statusMeta,
    fmtTime: window.fmtTime,
    chooseAI: function () {
      this.genChoice = 'ai';
      this.generate();
    },
    // /generate 会先删掉库里已有措施再插入，手动改动一并丢失且不可撤销，故先确认
    onGenerate: function () {
      if (this.measures.length &&
          !window.confirm('重新生成会覆盖当前全部措施（含您的手动修改），且无法撤销。\n\n确认继续？')) {
        return;
      }
      this.chooseAI();
    },
    chooseManual: function () {
      this.genChoice = 'manual';
      if (!this.measures.length) this.add();
    },
    async generate() {
      this.generating = true;
      try {
        var items = await window.API.post('/api/reports/' + this.report.id + '/generate');
        this.measures = (items || []).map(function (m) {
          return { content: m.content || '', verify_indicator: m.verify_indicator || '' };
        });
        this.report.status = 'measures_generated';
        this.genChoice = 'ai';
        window.toast('已生成 ' + this.measures.length + ' 条改进措施，请审阅修改', 'success');
      } catch (e) {
        this.genChoice = '';
        window.toast(e.message, 'error');
      } finally {
        this.generating = false;
      }
    },
    add: function () {
      this.measures.push({ content: '', verify_indicator: '' });
    },
    remove: function (idx) {
      this.measures.splice(idx, 1);
    },
    validate: function () {
      if (!this.measures.length) {
        window.toast('至少需要一条改进措施', 'error');
        return false;
      }
      for (var i = 0; i < this.measures.length; i++) {
        if (!String(this.measures[i].content || '').trim()) {
          window.toast('第 ' + (i + 1) + ' 条措施的内容不能为空', 'error');
          return false;
        }
      }
      return true;
    },
    payload: function () {
      return {
        measures: this.measures.map(function (m) {
          return {
            id: m.id || null,
            content: String(m.content || '').trim(),
            verify_indicator: String(m.verify_indicator || '').trim()
          };
        })
      };
    },
    async saveOnly() {
      if (!this.validate()) return;
      this.saving = true;
      try {
        await window.API.put('/api/reports/' + this.report.id + '/measures', this.payload());
        if (this.report.status === 'draft') this.report.status = 'measures_generated';
        window.toast('措施已保存', 'success');
      } catch (e) {
        window.toast(e.message, 'error');
      } finally {
        this.saving = false;
      }
    },
    async submitForApproval() {
      if (!this.validate()) return;
      this.saving = true;
      try {
        await window.API.put('/api/reports/' + this.report.id + '/measures', this.payload());
        await window.API.post('/api/reports/' + this.report.id + '/submit');
        window.toast('已提交专业负责人审批', 'success');
        this.$router.push('/teacher/dashboard');
      } catch (e) {
        window.toast(e.message, 'error');
      } finally {
        this.saving = false;
      }
    }
  }
};
