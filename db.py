# -*- coding: utf-8 -*-
"""数据库访问层：每请求一连接（Flask g 模式），统一日志入口"""
import json
import sqlite3
from datetime import datetime

from flask import g

import config


def _connect(path=None):
    conn = sqlite3.connect(path or config.DATABASE)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA busy_timeout=5000')
    conn.execute('PRAGMA foreign_keys=ON')
    return conn


def get_db():
    """获取当前请求的数据库连接（每请求一连接）"""
    if 'db' not in g:
        g.db = _connect()
    return g.db


def close_db(e=None):
    """teardown 时关闭连接"""
    db = g.pop('db', None)
    if db is not None:
        db.close()


def init_db():
    """执行 schema.sql 建表（幂等）+ 增量迁移"""
    conn = _connect()
    try:
        with open(config.SCHEMA_FILE, 'r', encoding='utf-8') as f:
            conn.executescript(f.read())
        # 增量迁移：academic_years 加 semester_count 列（旧库兼容）
        try:
            conn.execute('ALTER TABLE academic_years ADD COLUMN semester_count INTEGER NOT NULL DEFAULT 2')
        except sqlite3.OperationalError:
            pass  # 列已存在
        # 增量迁移：users 加 dingtalk_userid 列（钉钉登录绑定）
        try:
            conn.execute("ALTER TABLE users ADD COLUMN dingtalk_userid TEXT DEFAULT ''")
        except sqlite3.OperationalError:
            pass  # 列已存在
        # 增量迁移：users 加 must_change_password 列（首次登录强制改密）
        try:
            conn.execute('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0')
        except sqlite3.OperationalError:
            pass  # 列已存在
        conn.commit()
    finally:
        conn.close()


def now():
    """统一时间格式 YYYY-MM-DD HH:MM:SS"""
    return datetime.now().strftime('%Y-%m-%d %H:%M:%S')


def today():
    return datetime.now().strftime('%Y-%m-%d')


def log_action(db, user_id, action, object_type, object_id, detail=None):
    """统一操作日志入口，所有写操作必须调用"""
    db.execute(
        'INSERT INTO action_log (user_id, action, object_type, object_id, detail, created_at) '
        'VALUES (?, ?, ?, ?, ?, ?)',
        (user_id, action, object_type, object_id,
         json.dumps(detail or {}, ensure_ascii=False), now())
    )


def touch_report(db, report_id):
    db.execute('UPDATE reports SET updated_at=? WHERE id=?', (now(), report_id))


def get_report(db, report_id):
    return db.execute(
        'SELECT r.*, u.real_name AS teacher_name, u.username AS teacher_username, '
        'c.name AS course_name, c.code AS course_code, c.academic_year, c.term '
        'FROM reports r JOIN users u ON r.teacher_id=u.id '
        'JOIN courses c ON r.course_id=c.id WHERE r.id=?',
        (report_id,)
    ).fetchone()


def get_measures(db, report_id):
    return db.execute(
        'SELECT m.*, u.real_name AS assignee_name FROM measures m '
        'LEFT JOIN users u ON m.assignee_id=u.id '
        'WHERE m.report_id=? ORDER BY m.seq',
        (report_id,)
    ).fetchall()
