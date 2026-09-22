/* ============================================================
 * views/audit-logs.js —— 负责人端操作日志查询：对象类型/对象ID/用户筛选 + 分页
 * ============================================================ */
window.VIEWS.AuditLogs = {
  name: 'AuditLogs',
  template: `
  <div class="page">
    <div class="page-head">
      <div>
        <h1 class="page-title">操作日志查询</h1>
        <p class="page-sub">全程留痕 · 按对象类型、对象 ID、操作人检索系统操作记录</p>
      </div>
    </div>

    <div class="card">
      <div class="filter-bar">
        <div class="field">
          <label class="field-label">对象类型</label>
          <select class="select" v-model="fType">
            <option value="">全部类型</option>
            <option v-for="t in typeOptions" :key="t.value" :value="t.value">{{ t.label }}</option>
          </select>
        </div>
        <div class="field">
          <label class="field-label">对象 ID</label>
          <input class="input" v-model.trim="fObjectId" placeholder="如报告 ID：1"
                 @keyup.enter="reload(1)">
        </div>
        <div class="field">
          <label class="field-label">操作人</label>
          <select class="select" v-model="fUserId">
            <option value="">全部用户</option>
            <option v-for="u in users" :key="u.id" :value="u.id">
              {{ u.real_name }}（{{ u.username }}）
            </option>
          </select>
        </div>
        <button class="btn btn-primary btn-sm" @click="reload(1)"
                style="align-self:flex-end;margin-bottom:3px;">查询</button>
        <button class="btn btn-ghost btn-sm" @click="resetFilters"
                style="align-self:flex-end;margin-bottom:3px;">重置</button>
      </div>
    </div>

    <div class="card tight">
      <div v-if="loading" class="loading">正在查询操作日志</div>
      <div v-else-if="!items.length" class="empty">
        <span class="e-mark">志</span>未查询到符合条件的操作记录
      </div>
      <div class="table-wrap" v-else>
        <table class="tbl">
          <thead>
            <tr>
              <th style="width:150px;">时间</th>
              <th style="width:110px;">操作人</th>
              <th style="width:150px;">动作</th>
              <th style="width:130px;">对象</th>
              <th>详情</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in items" :key="item.id">
              <td class="cell-muted">{{ fmtTime(item.created_at) }}</td>
              <td>{{ item.user_name }}</td>
              <td><b style="font-weight:500;">{{ item.action }}</b></td>
              <td>
                <span class="cell-code">{{ typeLabel(item.object_type) }}</span>
                <span class="cell-muted" v-if="item.object_id">#{{ item.object_id }}</span>
              </td>
              <td><span class="cell-muted">{{ detailText(item.detail) }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="pager-bar" style="display:flex;align-items:center;justify-content:space-between;margin:10px 16px 4px;">
        <p class="form-hint" style="margin:0;">
          共 {{ total }} 条记录 · 第 {{ page }} / {{ pageCount }} 页
        </p>
        <div style="display:flex;gap:8px;" v-if="pageCount > 1">
          <button class="btn btn-ghost btn-sm" :disabled="page <= 1" @click="reload(page - 1)">上一页</button>
          <button class="btn btn-ghost btn-sm" :disabled="page >= pageCount" @click="reload(page + 1)">下一页</button>
        </div>
      </div>
    </div>
  </div>`,
  data: function () {
    return {
      loading: true,
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      fType: '',
      fObjectId: '',
      fUserId: '',
      users: [],
      typeOptions: [
        { value: 'report', label: '报告' },
        { value: 'user', label: '用户' },
        { value: 'course', label: '课程' },
        { value: 'academic_year', label: '学年' },
        { value: 'settings', label: 'AI 配置' },
        { value: 'import', label: '批量导入' }
      ]
    };
  },
  computed: {
    pageCount: function () {
      return Math.max(1, Math.ceil(this.total / this.pageSize));
    }
  },
  created: async function () {
    try {
      var dict = await window.API.get('/api/dictionaries');
      this.users = dict.users || [];
    } catch (e) {
      window.toast(e.message, 'error');
    }
    this.reload(1);
  },
  methods: {
    fmtTime: window.fmtTime,
    typeLabel: function (type) {
      var hit = this.typeOptions.find(function (t) { return t.value === type; });
      return hit ? hit.label : (type || '—');
    },
    detailText: function (detail) {
      if (!detail || typeof detail !== 'object') return '—';
      var parts = [];
      Object.keys(detail).forEach(function (k) {
        var v = detail[k];
        if (typeof v === 'object') v = JSON.stringify(v);
        parts.push(k + '=' + v);
      });
      return parts.length ? parts.join('，') : '—';
    },
    resetFilters: function () {
      this.fType = '';
      this.fObjectId = '';
      this.fUserId = '';
      this.reload(1);
    },
    async reload(page) {
      this.loading = true;
      try {
        var qs = 'page=' + page + '&page_size=' + this.pageSize;
        if (this.fType) qs += '&object_type=' + encodeURIComponent(this.fType);
        if (this.fObjectId) qs += '&object_id=' + encodeURIComponent(this.fObjectId);
        if (this.fUserId) qs += '&user_id=' + encodeURIComponent(this.fUserId);
        var data = await window.API.get('/api/logs?' + qs);
        this.items = data.items || [];
        this.total = data.total || 0;
        this.page = data.page || page;
        this.pageSize = data.page_size || this.pageSize;
      } catch (e) {
        window.toast(e.message, 'error');
      } finally {
        this.loading = false;
      }
    }
  }
};
