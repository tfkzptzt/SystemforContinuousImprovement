-- 高校课程持续改进系统 数据库结构
-- 报告状态唯一存于 reports.status；达成报告按措施一对一挂 measures，
-- 其生命周期由 achievements.status 承担（submitted ⇄ returned → approved）

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    real_name     TEXT NOT NULL,
    is_teacher    INTEGER NOT NULL DEFAULT 0,
    is_leader     INTEGER NOT NULL DEFAULT 0,
    is_admin      INTEGER NOT NULL DEFAULT 0,
    is_disabled   INTEGER NOT NULL DEFAULT 0,
    dingtalk_userid TEXT DEFAULT '',
    must_change_password INTEGER NOT NULL DEFAULT 0
);

-- 批量导入用户后生成的初始密码凭据包（临时、限时下载）
CREATE TABLE IF NOT EXISTS credential_bundles (
    id         TEXT PRIMARY KEY,
    data       TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS academic_years (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    semester_count INTEGER NOT NULL DEFAULT 2
);

CREATE TABLE IF NOT EXISTS courses (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    code          TEXT NOT NULL,
    academic_year TEXT NOT NULL,
    term          TEXT NOT NULL,
    start_date    TEXT,
    end_date      TEXT,
    leader_id     INTEGER REFERENCES users(id),
    UNIQUE (code, academic_year, term)
);

CREATE TABLE IF NOT EXISTS reports (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id   INTEGER NOT NULL REFERENCES users(id),
    course_id    INTEGER NOT NULL REFERENCES courses(id),
    leader_id    INTEGER REFERENCES users(id),
    title        TEXT DEFAULT '',
    file_path    TEXT DEFAULT '',
    content_text TEXT DEFAULT '',
    status       TEXT NOT NULL DEFAULT 'draft',
    source       TEXT NOT NULL DEFAULT 'upload' CHECK (source IN ('upload', 'import')),
    conclusion   TEXT DEFAULT '',
    concluded_at TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_teacher ON reports(teacher_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_leader ON reports(leader_id);

CREATE TABLE IF NOT EXISTS measures (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id        INTEGER NOT NULL REFERENCES reports(id),
    seq              INTEGER NOT NULL,
    content          TEXT NOT NULL DEFAULT '',
    verify_indicator TEXT DEFAULT '',
    assignee_id      INTEGER REFERENCES users(id),
    deadline         TEXT,
    status           TEXT NOT NULL DEFAULT 'draft'
);
CREATE INDEX IF NOT EXISTS idx_measures_report_seq ON measures(report_id, seq);
CREATE INDEX IF NOT EXISTS idx_measures_assignee ON measures(assignee_id);

CREATE TABLE IF NOT EXISTS achievements (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    measure_id   INTEGER NOT NULL UNIQUE REFERENCES measures(id),
    report_id    INTEGER NOT NULL REFERENCES reports(id),
    submitter_id INTEGER NOT NULL REFERENCES users(id),
    content      TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'returned', 'approved')),
    submitted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_achievements_status ON achievements(status);
CREATE INDEX IF NOT EXISTS idx_achievements_report ON achievements(report_id);

CREATE TABLE IF NOT EXISTS rejections (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    target_type TEXT NOT NULL CHECK (target_type IN ('measures', 'achievement')),
    target_id   INTEGER NOT NULL,
    reason      TEXT NOT NULL,
    rejecter_id INTEGER NOT NULL REFERENCES users(id),
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS action_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER REFERENCES users(id),
    action      TEXT NOT NULL,
    object_type TEXT NOT NULL,
    object_id   INTEGER,
    detail      TEXT DEFAULT '{}',
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_action_log_object ON action_log(object_type, object_id, created_at);
CREATE INDEX IF NOT EXISTS idx_action_log_created ON action_log(created_at);
