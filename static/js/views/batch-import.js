/* ============================================================
 * views/batch-import.js —— 批量导入：模板下载 + 上传 + 结果反馈
 * ============================================================ */
window.VIEWS.BatchImport = {
  name: 'BatchImport',
  template: `
  <div class="page" style="max-width:780px;">
    <div class="page-head">
      <div>
        <h1 class="page-title">批量导入</h1>
        <p class="page-sub">通过模板文件批量导入历史课程数据（支持 .xlsx / .csv）</p>
      </div>
    </div>

    <div class="card">
      <h3 class="card-title"><span><span class="idx">壹</span>下载导入模板</span></h3>
      <div class="notice notice-blue" style="margin-bottom:12px;">
        <span class="n-ico">✦</span>
        <span>请先下载标准模板，按模板表头填写数据后再上传。文件首行须为表头。</span>
      </div>
      <a class="btn btn-ghost" href="/api/import/template" download>⬇ 下载导入模板</a>
    </div>

    <div class="card">
      <h3 class="card-title"><span><span class="idx">贰</span>上传导入文件</span></h3>
      <div class="upload-zone" :class="{ 'has-file': file }" @click="pickFile">
        <template v-if="!file">
          <span class="up-ico">📥</span>
          <div>点击选择 .xlsx 或 .csv 文件</div>
        </template>
        <template v-else>
          <span class="up-ico">✅</span>
          <div class="up-name">{{ file.name }}</div>
          <div class="cell-muted" style="margin-top:4px;">点击可重新选择</div>
        </template>
      </div>
      <input type="file" ref="fileInput" accept=".xlsx,.csv" style="display:none;" @change="onFile">
      <div style="margin-top:16px;">
        <button class="btn btn-primary" @click="doImport" :disabled="!file || uploading" style="padding:9px 30px;">
          {{ uploading ? '正在导入…' : '开始导入' }}
        </button>
      </div>
    </div>

    <div class="card" v-if="result">
      <h3 class="card-title"><span><span class="idx">叁</span>导入结果</span></h3>
      <div class="grid-2" style="margin-bottom:14px;">
        <div class="stat-card" style="--sc: var(--green);">
          <div class="stat-num">{{ result.success_rows }}</div>
          <div><div class="stat-label">成功导入行数</div></div>
        </div>
        <div class="stat-card" style="--sc: var(--accent);">
          <div class="stat-num">{{ result.failed_rows }}</div>
          <div><div class="stat-label">失败行数</div></div>
        </div>
      </div>
      <div v-if="result.errors && result.errors.length">
        <div class="notice notice-red">
          <span class="n-ico">✕</span>
          <span>以下行导入失败，请修正后重新导入（成功行不会重复计入）。</span>
        </div>
        <div class="table-wrap">
          <table class="tbl">
            <thead>
              <tr><th style="width:90px;">行号</th><th>失败原因</th></tr>
            </thead>
            <tbody>
              <tr v-for="(e, i) in result.errors" :key="i">
                <td>第 {{ e.row }} 行</td>
                <td>{{ e.reason }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="notice notice-green" v-else>
        <span class="n-ico">✓</span>
        <span>全部数据导入成功！</span>
      </div>
    </div>
  </div>`,
  data: function () {
    return {
      file: null,
      uploading: false,
      result: null
    };
  },
  methods: {
    pickFile: function () { this.$refs.fileInput.click(); },
    onFile: function (evt) {
      var f = evt.target.files[0] || null;
      if (f) {
        var name = f.name.toLowerCase();
        if (!name.endsWith('.xlsx') && !name.endsWith('.csv')) {
          window.toast('仅支持 .xlsx / .csv 文件', 'error');
          evt.target.value = '';
          return;
        }
      }
      this.file = f;
      this.result = null;
    },
    async doImport() {
      if (!this.file) return;
      this.uploading = true;
      try {
        var fd = new FormData();
        fd.append('file', this.file);
        var data = await window.API.upload('/api/import', fd);
        this.result = data;
        window.toast('导入完成：成功 ' + data.success_rows + ' 行，失败 ' + data.failed_rows + ' 行',
          data.failed_rows ? 'info' : 'success');
      } catch (e) {
        window.toast(e.message, 'error');
      } finally {
        this.uploading = false;
      }
    }
  }
};
