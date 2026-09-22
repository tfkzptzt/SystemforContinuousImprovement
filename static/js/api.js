/* ============================================================
 * api.js —— fetch 封装 / 全局提示 / 状态元数据 / 公共工具
 * 约定：后端响应统一为 {"ok": true, "data": ...} 或 {"ok": false, "error": "中文原因"}
 * ============================================================ */
(function () {
  'use strict';

  /* ---------------- Toast 全局提示 ---------------- */
  function ensureToastWrap() {
    var wrap = document.getElementById('toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'toast-wrap';
      wrap.className = 'toast-wrap';
      document.body.appendChild(wrap);
    }
    return wrap;
  }

  function toast(msg, type) {
    var wrap = ensureToastWrap();
    var el = document.createElement('div');
    el.className = 'toast toast-' + (type || 'info');
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .3s, transform .3s';
      el.style.opacity = '0';
      el.style.transform = 'translateY(-10px)';
      setTimeout(function () { el.remove(); }, 320);
    }, type === 'error' ? 3600 : 2400);
  }

  /* ---------------- fetch 封装 ---------------- */
  function goLogin() {
    if (location.hash !== '#/login') location.hash = '#/login';
  }

  async function rawFetch(url, options) {
    options = options || {};
    options.credentials = 'same-origin';
    if (options.body && !(options.body instanceof FormData)) {
      options.headers = Object.assign(
        { 'Content-Type': 'application/json' }, options.headers || {});
    }
    var resp;
    try {
      resp = await fetch(url, options);
    } catch (e) {
      throw new Error('网络异常，请检查网络连接');
    }
    if (resp.status === 401) {
      // 登录失效：清理本地用户缓存，并重置 /api/auth/me 探测缓存，避免残留旧登录态
      window.AppUser = null;
      if (typeof window.resetAuthCache === 'function') window.resetAuthCache();
      toast('登录已失效，请重新登录', 'error');
      goLogin();
      throw new Error('未登录');
    }
    if (resp.status === 428) {
      // 首次登录强制改密：跳转「我的账户」引导修改（已在该页则静默抛出，避免重复提示）
      if (location.hash !== '#/account') {
        toast('首次登录请先修改初始密码', 'info');
        location.hash = '#/account';
      }
      throw new Error('首次登录请先修改初始密码');
    }
    var payload = null;
    try {
      payload = await resp.json();
    } catch (e) {
      throw new Error('服务器响应格式错误（' + resp.status + '）');
    }
    if (!payload || payload.ok !== true) {
      var msg = (payload && payload.error) ? payload.error : ('请求失败（' + resp.status + '）');
      throw new Error(msg);
    }
    return payload.data;
  }

  var API = {
    get: function (url) { return rawFetch(url, { method: 'GET' }); },
    post: function (url, body) {
      return rawFetch(url, { method: 'POST', body: body === undefined ? '{}' : JSON.stringify(body) });
    },
    put: function (url, body) {
      return rawFetch(url, { method: 'PUT', body: JSON.stringify(body) });
    },
    patch: function (url, body) {
      return rawFetch(url, { method: 'PATCH', body: JSON.stringify(body) });
    },
    del: function (url, body) {
      return rawFetch(url, {
        method: 'DELETE',
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    },
    upload: function (url, formData) {
      return rawFetch(url, { method: 'POST', body: formData });
    },
    raw: rawFetch
  };

  /* ---------------- 状态元数据（与后端 state_machine.STATUS_LABELS 对齐） ---------------- */
  var STATUS_META = {
    draft:               { label: '草稿',       cls: 'badge-gray' },
    measures_generated:  { label: '已生成措施', cls: 'badge-blue' },
    submitted:           { label: '待审批',     cls: 'badge-amber' },
    returned:            { label: '已退回',     cls: 'badge-red' },
    executing:           { label: '执行中',     cls: 'badge-teal' },
    concluded:           { label: '已定级',     cls: 'badge-ink' }
  };

  /** 达成状态元数据（逐措施） */
  var ACHIEVEMENT_STATUS_META = {
    null:      { label: '未填写',  cls: 'badge-gray' },
    submitted: { label: '待审核',  cls: 'badge-amber' },
    returned:  { label: '被打回',  cls: 'badge-red' },
    approved:  { label: '已通过',  cls: 'badge-green' }
  };

  function achievementMeta(status) {
    if (!status) return ACHIEVEMENT_STATUS_META['null'];
    return ACHIEVEMENT_STATUS_META[status] || { label: status, cls: 'badge-gray' };
  }

  function statusMeta(status) {
    return STATUS_META[status] || { label: status || '未知', cls: 'badge-gray' };
  }

  /* ---------------- 公共工具 ---------------- */
  function fmtTime(s) {
    if (!s) return '—';
    return String(s).replace('T', ' ').slice(0, 19);
  }

  function todayStr() {
    var d = new Date();
    function pad(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /** 当前日期是否不晚于 YYYY-MM-DD（date 为空视为不限） */
  function notExpired(deadline) {
    if (!deadline) return true;
    return todayStr() <= String(deadline).slice(0, 10);
  }

  /** 从报告详情中取出报告主体（兼容 {report:{...}} 与扁平两种返回结构） */
  function reportOf(detail) {
    if (!detail) return {};
    return detail.report || detail;
  }

  /** 取最近一条指定类型的退回记录（后端按时间升序返回） */
  function latestRejection(rejections, targetType) {
    var list = (rejections || []).filter(function (r) {
      return !targetType || r.target_type === targetType;
    });
    return list.length ? list[list.length - 1] : null;
  }

  /* ---------------- 当前用户（内存态，由路由守卫刷新） ---------------- */
  window.AppUser = null;

  window.API = API;
  window.toast = toast;
  window.statusMeta = statusMeta;
  window.STATUS_META = STATUS_META;
  window.achievementMeta = achievementMeta;
  window.ACHIEVEMENT_STATUS_META = ACHIEVEMENT_STATUS_META;
  window.fmtTime = fmtTime;
  window.todayStr = todayStr;
  window.notExpired = notExpired;
  window.reportOf = reportOf;
  window.latestRejection = latestRejection;
  window.VIEWS = window.VIEWS || {};
})();
