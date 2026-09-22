/* ============================================================
 * theme.js —— 主题管理：跟随系统 / 浅色 / 深色 + 深色纯黑（OLED）开关
 * 须在 <head> 中同步加载，于首帧绘制前写入 data-theme，避免闪白
 * ============================================================ */
(function () {
  'use strict';

  var KEY = 'app_theme';
  var KEY_OLED = 'app_theme_oled';
  var PREFS = ['auto', 'light', 'dark'];
  var LABELS = { auto: '跟随系统', light: '浅色', dark: '深色' };
  /* 均取无 emoji 呈现变体的几何符号，保证单色渲染并继承 currentColor */
  var ICONS = { auto: '◐', light: '☼', dark: '☾' };
  var OLED_ICON = '⬤';

  var mq = window.matchMedia('(prefers-color-scheme: dark)');

  function readPref() {
    try {
      var v = localStorage.getItem(KEY);
      // 旧版把 OLED 作为第四种模式存储，迁移为「深色 + 纯黑开关」
      if (v === 'oled') {
        localStorage.setItem(KEY, 'dark');
        localStorage.setItem(KEY_OLED, '1');
        return 'dark';
      }
      return PREFS.indexOf(v) >= 0 ? v : 'auto';
    } catch (e) {
      return 'auto';
    }
  }

  function readOled() {
    try {
      return localStorage.getItem(KEY_OLED) === '1';
    } catch (e) {
      return false;
    }
  }

  function resolve(pref) {
    if (pref === 'auto') return mq.matches ? 'dark' : 'light';
    return pref;
  }

  // 纯黑仅在深色下生效；浅色时忽略该开关
  function effective(pref, oled) {
    var r = resolve(pref);
    return (r === 'dark' && oled) ? 'oled' : r;
  }

  var pref = readPref();
  var oled = readOled();
  var listeners = [];

  function notify() {
    for (var i = 0; i < listeners.length; i++) listeners[i](pref, oled);
  }

  function apply() {
    var root = document.documentElement;
    root.dataset.theme = effective(pref, oled);
    root.dataset.themePref = pref;
  }

  apply();

  function onSystemChange() {
    if (pref === 'auto') {
      apply();
      notify();
    }
  }

  if (mq.addEventListener) mq.addEventListener('change', onSystemChange);
  else if (mq.addListener) mq.addListener(onSystemChange);

  window.AppTheme = {
    PREFS: PREFS,
    LABELS: LABELS,
    ICONS: ICONS,
    get: function () { return pref; },
    getOled: function () { return oled; },
    resolved: function () { return resolve(pref); },
    isPureBlack: function () { return effective(pref, oled) === 'oled'; },
    /** 供组件按自身响应式副本求值，保证 computed 可追踪依赖 */
    iconOf: function (p, o, resolved) {
      return (resolved === 'dark' && o) ? OLED_ICON : (ICONS[p] || '◐');
    },
    labelOf: function (p, o, resolved) {
      return (resolved === 'dark' && o) ? (LABELS.dark + '·纯黑') : (LABELS[p] || '');
    },
    icon: function () { return this.iconOf(pref, oled, resolve(pref)); },
    label: function () { return this.labelOf(pref, oled, resolve(pref)); },
    /** 订阅主题变化，返回退订函数 */
    onChange: function (fn) {
      listeners.push(fn);
      return function () {
        var i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    set: function (mode) {
      pref = PREFS.indexOf(mode) >= 0 ? mode : 'auto';
      try { localStorage.setItem(KEY, pref); } catch (e) { /* 隐私模式忽略 */ }
      apply();
      notify();
    },
    setOled: function (on) {
      oled = !!on;
      try { localStorage.setItem(KEY_OLED, oled ? '1' : '0'); } catch (e) { /* 隐私模式忽略 */ }
      apply();
      notify();
    },
    /** 切到下一个偏好，返回切换后的偏好名（供顶栏/登录按钮循环调用） */
    next: function () {
      this.set(PREFS[(PREFS.indexOf(pref) + 1) % PREFS.length]);
      return pref;
    }
  };
})();
