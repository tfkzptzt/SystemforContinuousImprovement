/* ============================================================
 * router.js —— Vue Router（hash 模式）路由表 + 全局守卫 + 应用外壳挂载
 * 角色隔离：/teacher/* 仅教师，/leader/* 仅专业负责人，/admin/* 仅管理员，
 * /records、/history 多端共享；用户可同时拥有多个角色标志位（0/1）
 * ============================================================ */
(function () {
  'use strict';

  var V = window.VIEWS;

  /* ---------------- 当前用户探测（静默，不弹提示） ---------------- */
  var mePromise = null;

  function fetchMe() {
    if (!mePromise) {
      mePromise = fetch('/api/auth/me', { credentials: 'same-origin' })
        .then(function (resp) {
          if (resp.status === 401) return null;
          return resp.json();
        })
        .then(function (payload) {
          return (payload && payload.ok === true) ? payload.data : null;
        })
        .catch(function () { return null; });
    }
    return mePromise;
  }

  /** 登录/退出后重置缓存，供登录页与退出按钮调用 */
  window.resetAuthCache = function () { mePromise = null; };

  /* ---------------- 路由表 ---------------- */
  var routes = [
    { path: '/', component: { render: function () { return null; } } },
    { path: '/login', component: V.Login, meta: { public: true } },

    /* ---- 教师端 ---- */
    { path: '/teacher/dashboard', component: V.TeacherDashboard, meta: { role: 'teacher' } },
    { path: '/teacher/reports/new', component: V.ReportCreate, meta: { role: 'teacher' } },
    { path: '/teacher/tasks', component: V.TeacherTasks, meta: { role: 'teacher' } },
    { path: '/teacher/measures/:id', component: V.MeasureEditor, meta: { role: 'teacher' } },
    { path: '/teacher/execute/:mid', component: V.ExecutionForm, meta: { role: 'teacher' } },
    { path: '/teacher/records', component: V.TeacherRecords, meta: { role: 'teacher' } },

    /* ---- 专业负责人端 ---- */
    { path: '/leader/dashboard', component: V.LeaderDashboard, meta: { role: 'leader' } },
    { path: '/leader/approve/:id', component: V.LeaderApproveMeasures, meta: { role: 'leader' } },
    { path: '/leader/review/:id', component: V.LeaderReviewAchievement, meta: { role: 'leader' } },
    { path: '/leader/import', component: V.BatchImport, meta: { role: 'leader' } },
    { path: '/leader/audit-logs', component: V.AuditLogs, meta: { role: 'leader' } },

    /* ---- 两端共享 ---- */
    { path: '/records/:id', component: V.RecordDetail, meta: {} },
    { path: '/history', component: V.HistoryQuery, meta: {} },
    { path: '/account', component: V.MyAccount, meta: {} },
    { path: '/dingtalk-callback', component: V.DingtalkCallback, meta: { public: true } },

    /* ---- 管理后台 ---- */
    { path: '/admin/users', component: V.AdminUsers, meta: { role: 'admin' } },
    { path: '/admin/years', component: V.AdminYears, meta: { role: 'admin' } },
    { path: '/admin/courses', component: V.AdminCourses, meta: { role: 'admin' } },
    { path: '/admin/ai', component: V.AdminAi, meta: { role: 'admin' } },
    { path: '/admin/dingtalk', component: V.AdminDingtalk, meta: { role: 'admin' } },
    { path: '/admin/security', component: V.AdminSecurity, meta: { role: 'admin' } },

    { path: '/:pathMatch(.*)*', redirect: '/' }
  ];

  var router = VueRouter.createRouter({
    history: VueRouter.createWebHashHistory(),
    routes: routes
  });

  /* ---------------- 全局守卫：登录态 + 角色隔离 ---------------- */
  function homeOf(user) {
    if (user && user.is_admin) return '/admin/users';
    if (user && user.is_teacher) return '/teacher/dashboard';
    return '/leader/dashboard';
  }

  /** meta.role → 用户标志位判断 */
  function hasRole(user, need) {
    if (need === 'teacher') return !!user.is_teacher;
    if (need === 'leader') return !!user.is_leader;
    if (need === 'admin') return !!user.is_admin;
    return true;
  }

  router.beforeEach(async function (to) {
    if (to.meta.public) return true;

    // 优先信任内存中的当前用户（登录后立即生效），否则探测 /api/auth/me
    var user = window.AppUser;
    if (!user) {
      user = await fetchMe();
      window.AppUser = user;
    }
    if (!user) return '/login';

    // 首次登录强制改密：改密前只允许停留在「我的账户」
    if (user.must_change_password && to.path !== '/account') {
      window.toast('首次登录请先修改初始密码', 'info');
      return '/account';
    }

    if (to.path === '/') return homeOf(user);

    var need = to.meta.role;
    if (need && !hasRole(user, need)) {
      window.toast(need === 'teacher'
        ? '该页面仅限教师访问'
        : (need === 'leader'
          ? '该页面仅限专业负责人访问'
          : '该页面仅限管理员访问'), 'error');
      return homeOf(user);
    }
    return true;
  });

  /* ---------------- 应用外壳：顶部导航 + 用户信息 + 退出 ---------------- */
  var AppShell = {
    template: `
    <div>
      <header class="topbar" v-if="user">
        <div class="brand">
          <img class="brand-logo" src="/static/img/logo.png" alt="应急管理大学校徽">
          <span class="brand-name">高校课程持续改进系统</span>
          <span class="brand-sub">{{ brandSub }}</span>
        </div>
        <nav class="topnav" :class="{ open: navOpen }">
          <template v-if="user.is_admin">
            <router-link to="/admin/users">用户管理</router-link>
            <router-link to="/admin/years">学年管理</router-link>
            <router-link to="/admin/courses">课程管理</router-link>
            <router-link to="/admin/ai">AI 配置</router-link>
            <router-link to="/admin/dingtalk">钉钉登录</router-link>
            <router-link to="/admin/security">安全选项</router-link>
          </template>
          <template v-else>
            <template v-if="user.is_teacher">
              <router-link to="/teacher/dashboard">仪表盘</router-link>
              <router-link to="/teacher/tasks">我的任务</router-link>
              <router-link to="/teacher/reports/new">新建报告</router-link>
              <router-link to="/teacher/records">我的记录</router-link>
            </template>
            <span v-if="user.is_teacher && user.is_leader" class="nav-divider"></span>
            <template v-if="user.is_leader">
              <router-link to="/leader/dashboard">待审批</router-link>
              <router-link to="/leader/import">批量导入</router-link>
              <router-link to="/leader/audit-logs">操作日志</router-link>
            </template>
            <router-link to="/history">历史查询</router-link>
          </template>
        </nav>
        <div class="topbar-user">
          <button class="theme-toggle" @click="cycleTheme" :title="'主题：' + themeLabel" :aria-label="'切换主题，当前' + themeLabel">
            {{ themeIcon }}
          </button>
          <div class="user-chip" style="cursor:pointer;" @click="$router.push('/account')">
            <span class="user-avatar">{{ avatarChar }}</span>
            <span>
              <span class="user-name">{{ user.real_name }}</span>
              <span class="user-role">{{ roleText }}</span>
            </span>
          </div>
          <button class="btn btn-sm" style="background:rgba(243,239,228,.14);color:#f3efe4;border-color:rgba(243,239,228,.3);"
                  @click="logout">退出</button>
        </div>
        <button class="nav-toggle" :class="{ open: navOpen }" aria-label="展开菜单"
                @click="navOpen = !navOpen">
          <span></span><span></span><span></span>
        </button>
      </header>
      <router-view></router-view>
      <div class="footer-note" v-if="user">高校课程持续改进系统 · 全程留痕 · 可追可溯</div>
    </div>`,
    data: function () {
      return {
        navOpen: false, // 移动端汉堡菜单展开状态（桌面端菜单常显，此状态无副作用）
        themeMode: window.AppTheme ? window.AppTheme.get() : 'auto',
        themeOled: window.AppTheme ? window.AppTheme.getOled() : false,
        themeResolved: window.AppTheme ? window.AppTheme.resolved() : 'light'
      };
    },
    watch: {
      '$route': function () { this.navOpen = false; } // 路由切换后自动收起菜单
    },
    created: function () {
      var self = this;
      if (window.AppTheme) {
        this._unsubTheme = window.AppTheme.onChange(function () { self.syncTheme(); });
      }
    },
    beforeUnmount: function () {
      if (this._unsubTheme) this._unsubTheme();
    },
    computed: {
      user: function () {
        void this.$route.fullPath; // 路由变化时重新求值
        return window.AppUser;
      },
      avatarChar: function () {
        return this.user ? (this.user.real_name || '用').slice(0, 1) : '';
      },
      roleText: function () {
        var u = this.user;
        if (!u) return '';
        if (u.is_admin) return '管理员';
        var parts = [];
        if (u.is_teacher) parts.push('教师');
        if (u.is_leader) parts.push('专业负责人');
        return parts.join(' · ');
      },
      brandSub: function () {
        var u = this.user;
        if (!u) return '';
        if (u.is_admin) return '管理后台';
        var parts = [];
        if (u.is_teacher) parts.push('教师端');
        if (u.is_leader) parts.push('负责人端');
        return parts.join(' · ');
      },
      themeLabel: function () {
        var T = window.AppTheme;
        return T ? T.labelOf(this.themeMode, this.themeOled, this.themeResolved) : '';
      },
      themeIcon: function () {
        var T = window.AppTheme;
        return T ? T.iconOf(this.themeMode, this.themeOled, this.themeResolved) : '◐';
      }
    },
    methods: {
      syncTheme: function () {
        var T = window.AppTheme;
        if (!T) return;
        this.themeMode = T.get();
        this.themeOled = T.getOled();
        this.themeResolved = T.resolved();
      },
      cycleTheme: function () {
        var T = window.AppTheme;
        if (!T) return;
        T.next();
        this.syncTheme();
        window.toast('主题：' + T.label(), 'info');
      },
      async logout() {
        try { await window.API.post('/api/auth/logout'); } catch (e) { /* 忽略 */ }
        window.AppUser = null;
        window.resetAuthCache();
        window.toast('已退出登录', 'info');
        this.$router.push('/login');
      }
    }
  };

  var app = Vue.createApp(AppShell);
  app.use(router);
  app.mount('#app');
})();
