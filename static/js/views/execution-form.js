/* ============================================================
 * views/execution-form.js —— 按措施填写达成报告（路由 /teacher/execute/:mid）
 * ============================================================ */
window.VIEWS.ExecutionForm = {
  name: 'ExecutionForm',
  template: `
  <div class="page" style="max-width:860px;">
    <div class="page-head">
      <div>
        <h1 class="page-title">{{ isReadonly ? '达成报告详情' : '填写达成报告' }}</h1>
        <p class="page-sub" v-if="task.course_name">
          {{ task.course_name }} · {{ task.academic_year }} · {{ task.term }}
        </p>
      </div>
      <span class="badge" :class="achievementMeta(task.achievement_status).cls" v-if="task.achievement_status !== undefined">
        {{ achievementMeta(task.achievement_status).label }}
      </span>
    </div>

    <div v-if="loading" class="loading">正在加载措施信息</div>

    <template v-else>
      <!-- 打回提示 -->
      <div class="notice notice-red" v-if="task.achievement_status === 'returned' && returnedReason">
        <span class="n-ico">✕</span>
        <div><b>达成报告被打回</b>：{{ returnedReason }}<br>请根据意见修改后重新提交。</div>
      </div>

      <!-- 已通过提示 -->
      <div class="notice notice-green" v-if="task.achievement_status === 'approved'">
        <span class="n-ico">✓</span>
        <div>该措施的达成报告已通过审核，内容仅供查看。</div>
      </div>

      <!-- 措施上下文 -->
      <div class="card">
        <h3 class="card-title"><span><span class="idx">壹</span>措施信息</span></h3>
        <div class="info-grid">
          <div class="info-item"><div class="k">所属报告</div><div class="v">{{ task.report_title || '—' }}</div></div>
          <div class="info-item"><div class="k">课程</div><div class="v">{{ task.course_name || '—' }}</div></div>
          <div class="info-item"><div class="k">学年 / 学期</div><div class="v">{{ task.academic_year }} · {{ task.term }}</div></div>
          <div class="info-item"><div class="k">截止日期</div><div class="v">
            {{ task.deadline || '—' }}
            <span v-if="task.deadline && !notExpired(task.deadline)" class="badge badge-red" style="margin-left:6px;">已过期</span>
          </div></div>
        </div>
        <div style="margin-top:14px;">
          <div class="cell-muted" style="margin-bottom:4px;">措施内容</div>
          <div class="prose">{{ task.content }}</div>
        </div>
        <div v-if="task.verify_indicator" style="margin-top:10px;">
          <div class="cell-muted" style="margin-bottom:4px;">验证指标</div>
          <div class="prose">{{ task.verify_indicator }}</div>
        </div>
      </div>

      <!-- 达成报告填写 -->
      <div class="card">
        <h3 class="card-title"><span><span class="idx">贰</span>达成报告</span></h3>
        <div class="field">
          <label class="field-label">
            {{ isReadonly ? '已提交的达成报告内容' : '请填写该措施的达成情况' }}
            <span class="req" v-if="!isReadonly">*</span>
          </label>
          <textarea class="textarea" v-model="content" rows="8" :readonly="isReadonly"
                    :class="{ 'textarea-readonly': isReadonly }"
                    :placeholder="isReadonly ? '' : placeholderText"></textarea>
          <p class="form-hint" v-if="!isReadonly">内容将提交专业负责人审核，请如实、完整填写。</p>
        </div>
        <div class="btn-row" style="display:flex;gap:12px;justify-content:flex-end;" v-if="!isReadonly">
          <router-link class="btn btn-ghost" to="/teacher/tasks">返回任务列表</router-link>
          <button class="btn btn-accent" @click="submit" :disabled="submitting" style="padding:8px 30px;">
            {{ submitting ? '提交中…' : (task.achievement_status === 'returned' ? '重新提交' : '提交审核') }}
          </button>
        </div>
        <div class="btn-row" style="display:flex;gap:12px;justify-content:flex-end;" v-else>
          <router-link class="btn btn-ghost" to="/teacher/tasks">返回任务列表</router-link>
        </div>
      </div>
    </template>
  </div>`,
  data: function () {
    return {
      loading: true,
      submitting: false,
      task: {},
      content: '',
      returnedReason: ''
    };
  },
  computed: {
    isReadonly: function () {
      return this.task.achievement_status === 'approved' || this.task.achievement_status === 'submitted';
    },
    placeholderText: function () {
      return '请说明该措施的执行与达成情况，例如：\n已在下一轮教学中增加两次阶段性综合训练，期末综合题平均分由 58 分提升至 72 分，达成验证指标。';
    }
  },
  created: async function () {
    var mid = this.$route.params.mid;
    try {
      // 从 mine 列表获取措施上下文（含 achievement_content/achievement_id）
      var tasks = await window.API.get('/api/measures/mine');
      var found = null;
      for (var i = 0; i < tasks.length; i++) {
        if (String(tasks[i].measure_id) === String(mid)) { found = tasks[i]; break; }
      }
      if (!found) {
        window.toast('未找到该措施，可能不属于您或报告已结束', 'error');
        this.$router.push('/teacher/tasks');
        return;
      }
      this.task = found;
      this.returnedReason = found.returned_reason || '';

      // 直接用 mine 返回的 achievement_content 预填（被打回时预填原内容，已通过时只读展示）
      if (found.achievement_content) {
        this.content = found.achievement_content;
      }
    } catch (e) {
      window.toast('加载措施信息失败：' + e.message, 'error');
    } finally {
      this.loading = false;
    }
  },
  methods: {
    achievementMeta: window.achievementMeta,
    notExpired: window.notExpired,
    async submit() {
      if (!String(this.content || '').trim()) {
        window.toast('请填写达成报告内容', 'error');
        return;
      }
      this.submitting = true;
      try {
        await window.API.post('/api/measures/' + this.task.measure_id + '/achievement', {
          content: String(this.content).trim()
        });
        window.toast('达成报告已提交，等待负责人审核', 'success');
        this.$router.push('/teacher/tasks');
      } catch (e) {
        window.toast(e.message, 'error');
      } finally {
        this.submitting = false;
      }
    }
  }
};
