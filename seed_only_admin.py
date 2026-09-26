# -*- coding: utf-8 -*-
"""建库 + 种子数据（幂等，可重复执行）"""
import glob
import os
import sqlite3

from werkzeug.security import generate_password_hash

import config
import db as db_mod
from services import importer
from services.ai_config import DEFAULT_PROMPT

SEED_USERS = [
    ('admin01', '管理员', {'is_admin': 1}),
]
SEED_PASSWORD = '123456'

SEED_YEARS = []

SEED_COURSES = []


def seed():
    db_mod.init_db()
    importer.ensure_import_template()

    # ⚠️ 清空 uploads/ 下的原始报告，仅适用于「全新建库」。
    # init_db() 执行的是 CREATE TABLE IF NOT EXISTS，对已存在的库并不会重建表；
    # 因此在已有业务数据上重跑本脚本，会删掉 .docx 文件却留下指向它们的 reports
    # 行，导致列表可见但下载与预览全部失效。生产环境严禁重跑。
    os.makedirs(config.UPLOAD_DIR, exist_ok=True)
    for path in glob.glob(os.path.join(config.UPLOAD_DIR, '*.docx')):
        os.remove(path)

    conn = sqlite3.connect(config.DATABASE)
    try:
        for username, real_name, flags in SEED_USERS:
            conn.execute(
                'INSERT OR IGNORE INTO users '
                '(username, password_hash, real_name, is_teacher, is_leader, is_admin) '
                'VALUES (?, ?, ?, ?, ?, ?)',
                (username, generate_password_hash(SEED_PASSWORD), real_name,
                 flags.get('is_teacher', 0), flags.get('is_leader', 0),
                 flags.get('is_admin', 0)))
        for year in SEED_YEARS:
            conn.execute('INSERT OR IGNORE INTO academic_years (name) VALUES (?)', (year,))
        # 默认 settings：仅种 ai_prompt 模板一条，其余键缺省走环境变量/默认值
        # （INSERT OR IGNORE：不覆盖管理员已保存的配置，重跑幂等）
        conn.execute('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)',
                     ('ai_prompt', DEFAULT_PROMPT))
        leader = conn.execute(
            "SELECT id FROM users WHERE username='leader01'").fetchone()
        leader_id = leader[0] if leader else None
        for name, code, year, term, start, end in SEED_COURSES:
            conn.execute(
                'INSERT OR IGNORE INTO courses '
                '(name, code, academic_year, term, start_date, end_date, leader_id) '
                'VALUES (?, ?, ?, ?, ?, ?, ?)',
                (name, code, year, term, start, end, leader_id))
        conn.commit()
    finally:
        conn.close()

    print(f'数据库就绪：{config.DATABASE}')
    print(f'种子用户 {len(SEED_USERS)} 个（密码 {SEED_PASSWORD}），'
          f'种子学年 {len(SEED_YEARS)} 个，'
          f'种子课程 {len(SEED_COURSES)} 门（负责人均指派 leader01），'
          f'默认 AI 提示词已写入 settings，导入模板已就绪。')


if __name__ == '__main__':
    seed()
