# -*- coding: utf-8 -*-
"""新流程 API 集成测试：报告删除、我的任务、按措施提交达成、逐份审批/打回、
整体定级守卫、审批指派强校验、AI 配置端点、批量导入新写入
（Flask test client + 临时数据库，全程不触真实网络）"""
import io
import json
import os
import sqlite3
import sys
import tempfile
import unittest
import urllib.error
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config  # noqa: E402
from werkzeug.security import generate_password_hash  # noqa: E402

_TMPDIR = tempfile.TemporaryDirectory()
config.DATABASE = os.path.join(_TMPDIR.name, 'test.db')
config.UPLOAD_DIR = os.path.join(_TMPDIR.name, 'uploads')
config.RATELIMIT_ENABLED = False  # 关闭登录限速，避免共享内存限速器跨用例累计触发 429

import db as db_mod  # noqa: E402
from app import create_app  # noqa: E402
from db import now  # noqa: E402
from services import ai_config  # noqa: E402

PASSWORD = '123456'
FUTURE = '2099-12-31'
PAST = '2020-01-01'


def _conn():
    conn = sqlite3.connect(config.DATABASE)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys=ON')
    return conn


class _FakeResponse(io.BytesIO):
    """模拟 urlopen 返回的响应对象（支持上下文管理器 + read()）"""

    def __init__(self, text):
        super().__init__(text.encode('utf-8'))

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
        return False


class FlowApiBase(unittest.TestCase):
    def setUp(self):
        for suffix in ('', '-wal', '-shm'):
            p = config.DATABASE + suffix
            if os.path.exists(p):
                os.remove(p)
        db_mod.init_db()
        conn = _conn()
        try:
            users = [
                ('teacher01', '王老师', 1, 0, 0, 0),
                ('teacher02', '吴老师', 1, 0, 0, 0),
                ('leader01', '张主任', 0, 1, 0, 0),
                ('leader02', '刘主任', 0, 1, 0, 0),
                ('admin01', '管理员', 0, 0, 1, 0),
                ('disabled01', '停用教师', 1, 0, 0, 1),
            ]
            for u, n, t, l, a, d in users:
                conn.execute(
                    'INSERT INTO users (username, password_hash, real_name, is_teacher, '
                    'is_leader, is_admin, is_disabled) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    (u, generate_password_hash(PASSWORD), n, t, l, a, d))
            conn.execute("INSERT INTO academic_years (name) VALUES ('2025-2026学年')")
            leader = conn.execute(
                "SELECT id FROM users WHERE username='leader01'").fetchone()
            conn.execute(
                'INSERT INTO courses (name, code, academic_year, term, start_date, '
                'end_date, leader_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
                ('工程制图', 'GCTZ1001', '2025-2026学年', '第一学期',
                 '2025-09-01', '2025-12-31', leader['id']))
            conn.commit()
        finally:
            conn.close()
        self.app = create_app()
        self.app.config['TESTING'] = True
        self.client = self.app.test_client()

    # ---------- 工具 ----------

    def login(self, username):
        return self.client.post('/api/auth/login',
                                json={'username': username, 'password': PASSWORD})

    def uid(self, username):
        conn = _conn()
        try:
            return conn.execute(
                'SELECT id FROM users WHERE username=?', (username,)).fetchone()['id']
        finally:
            conn.close()

    def query(self, sql, args=()):
        conn = _conn()
        try:
            return conn.execute(sql, args).fetchall()
        finally:
            conn.close()

    def exec_sql(self, sql, args=()):
        conn = _conn()
        try:
            cur = conn.execute(sql, args)
            conn.commit()
            return cur.lastrowid
        finally:
            conn.close()

    def insert_report(self, teacher='teacher01', leader='leader01', status='draft',
                      file_path=''):
        course_id = self.query('SELECT id FROM courses')[0]['id']
        return self.exec_sql(
            'INSERT INTO reports (teacher_id, course_id, leader_id, title, file_path, '
            'status, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (self.uid(teacher), course_id,
             self.uid(leader) if leader else None,
             f'报告-{status}', file_path, status, 'upload', now(), now()))

    def insert_measure(self, rid, seq=1, content='措施内容', assignee=None,
                       deadline=None, status='draft'):
        return self.exec_sql(
            'INSERT INTO measures (report_id, seq, content, verify_indicator, '
            'assignee_id, deadline, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
            (rid, seq, content, '验证指标',
             self.uid(assignee) if assignee else None, deadline, status))

    def make_executing(self, n_measures=2, deadline=FUTURE, teacher='teacher01',
                       leader='leader01'):
        """构造处于 executing 的报告：n 条措施均指派 teacher、含截止时间"""
        rid = self.insert_report(teacher=teacher, leader=leader, status='executing')
        mids = [self.insert_measure(rid, seq=i + 1, content=f'措施{i + 1}',
                                    assignee=teacher, deadline=deadline,
                                    status='assigned')
                for i in range(n_measures)]
        return rid, mids

    def submit_achievement(self, mid, content='达成内容', client=None):
        c = client or self.client
        return c.post(f'/api/measures/{mid}/achievement', json={'content': content})

    def achievement_id(self, mid):
        rows = self.query('SELECT id FROM achievements WHERE measure_id=?', (mid,))
        return rows[0]['id'] if rows else None


# ---------------------------------------------------------------------------
# 1. 报告删除 DELETE /api/reports/<rid>
# ---------------------------------------------------------------------------
class ReportDeleteTest(FlowApiBase):
    def test_owner_deletes_draft_report_and_file(self):
        os.makedirs(config.UPLOAD_DIR, exist_ok=True)
        fpath = os.path.join(config.UPLOAD_DIR, 'todelete.docx')
        with open(fpath, 'wb') as f:
            f.write(b'x')
        rid = self.insert_report(status='draft', file_path=fpath)
        mid = self.insert_measure(rid)
        self.exec_sql(
            "INSERT INTO rejections (target_type, target_id, reason, rejecter_id, "
            "created_at) VALUES ('measures', ?, '旧退回', ?, ?)",
            (rid, self.uid('leader01'), now()))
        self.login('teacher01')
        r = self.client.delete(f'/api/reports/{rid}')
        body = r.get_json()
        self.assertTrue(body['ok'], body)
        self.assertEqual(body['data'], {'id': rid})
        # 级联干净：报告/措施/措施退回记录全部删除，上传文件删除
        self.assertEqual(len(self.query('SELECT * FROM reports WHERE id=?', (rid,))), 0)
        self.assertEqual(len(self.query('SELECT * FROM measures WHERE id=?', (mid,))), 0)
        self.assertEqual(len(self.query(
            "SELECT * FROM rejections WHERE target_type='measures' AND target_id=?",
            (rid,))), 0)
        self.assertFalse(os.path.exists(fpath))
        # action_log 保留（审计不回删）+ 新增删除日志
        self.assertGreaterEqual(len(self.query(
            "SELECT * FROM action_log WHERE action='删除报告' AND object_id=?", (rid,))), 1)

    def test_non_owner_forbidden(self):
        rid = self.insert_report(teacher='teacher01', status='draft')
        self.login('teacher02')
        r = self.client.delete(f'/api/reports/{rid}')
        self.assertEqual(r.status_code, 403)
        self.assertEqual(len(self.query('SELECT * FROM reports WHERE id=?', (rid,))), 1)

    def test_status_not_allowed(self):
        self.login('teacher01')
        for status in ('submitted', 'executing', 'concluded'):
            rid = self.insert_report(status=status)
            r = self.client.delete(f'/api/reports/{rid}')
            self.assertEqual(r.status_code, 400, status)
            self.assertEqual(r.get_json()['error'], '当前状态不允许删除')
            self.assertEqual(
                len(self.query('SELECT * FROM reports WHERE id=?', (rid,))), 1)

    def test_allowed_statuses(self):
        self.login('teacher01')
        for status in ('draft', 'measures_generated', 'returned'):
            rid = self.insert_report(status=status)
            r = self.client.delete(f'/api/reports/{rid}')
            self.assertTrue(r.get_json()['ok'], (status, r.get_json()))

    def test_missing_report_404(self):
        self.login('teacher01')
        self.assertEqual(self.client.delete('/api/reports/9999').status_code, 404)

    def test_concurrent_status_change_rowcount_guard(self):
        # 预检读到 draft 后、DELETE 前报告被并发提交：DELETE 带 status IN 条件
        # rowcount=0 → 400，且事务未提交（级联删除全部回滚，数据保持完整）
        rid = self.insert_report(status='draft')
        mid = self.insert_measure(rid)
        self.exec_sql(
            "INSERT INTO rejections (target_type, target_id, reason, rejecter_id, "
            "created_at) VALUES ('measures', ?, '保留退回', ?, ?)",
            (rid, self.uid('leader01'), now()))
        self.login('teacher01')
        real_connect = db_mod._connect
        state = {'fired': False}

        class ConnProxy:
            """拦截 DELETE FROM reports：不执行，直接返回 rowcount=0 的假游标，
            模拟“预检读到 draft 后、DELETE 前报告被并发提交”的竞态结果"""

            def __init__(self, conn):
                self._conn = conn

            def execute(self, sql, *a, **kw):
                if not state['fired'] and sql.strip().startswith('DELETE FROM reports'):
                    state['fired'] = True
                    mock_cur = mock.Mock()
                    mock_cur.rowcount = 0
                    return mock_cur
                return self._conn.execute(sql, *a, **kw)

            def __getattr__(self, name):
                return getattr(self._conn, name)

        with mock.patch.object(db_mod, '_connect',
                               lambda path=None: ConnProxy(real_connect(path))):
            r = self.client.delete(f'/api/reports/{rid}')
        self.assertTrue(state['fired'])
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.get_json()['error'], '当前状态不允许删除')
        # 事务回滚：级联删除全部未生效，报告/措施/退回记录完整保留，无删除日志
        self.assertEqual(self.query(
            'SELECT status FROM reports WHERE id=?', (rid,))[0]['status'], 'draft')
        self.assertEqual(len(self.query('SELECT * FROM measures WHERE id=?', (mid,))), 1)
        self.assertEqual(len(self.query(
            "SELECT * FROM rejections WHERE target_type='measures' AND target_id=?",
            (rid,))), 1)
        self.assertEqual(len(self.query(
            "SELECT * FROM action_log WHERE action='删除报告'")), 0)

    def test_leader_cannot_delete(self):
        rid = self.insert_report(status='draft')
        self.login('leader01')
        r = self.client.delete(f'/api/reports/{rid}')
        self.assertEqual(r.status_code, 403)


# ---------------------------------------------------------------------------
# 1b. 手动填写措施 PUT /api/reports/<rid>/measures（草稿直接保存）
# ---------------------------------------------------------------------------
class ManualMeasuresTest(FlowApiBase):
    def test_manual_save_from_draft_transitions(self):
        rid = self.insert_report(status='draft')
        self.login('teacher01')
        r = self.client.put(f'/api/reports/{rid}/measures', json={'measures': [
            {'content': '手动措施一', 'verify_indicator': '指标一'},
            {'content': '手动措施二', 'verify_indicator': ''},
        ]})
        body = r.get_json()
        self.assertTrue(body['ok'], body)
        # 草稿手动保存后状态迁移为已生成措施
        self.assertEqual(
            self.query('SELECT status FROM reports WHERE id=?', (rid,))[0]['status'],
            'measures_generated')
        rows = self.query(
            'SELECT seq, content, verify_indicator FROM measures WHERE report_id=? ORDER BY seq',
            (rid,))
        self.assertEqual([r['content'] for r in rows], ['手动措施一', '手动措施二'])
        self.assertEqual(rows[0]['verify_indicator'], '指标一')

    def test_manual_save_empty_rejected(self):
        rid = self.insert_report(status='draft')
        self.login('teacher01')
        r = self.client.put(f'/api/reports/{rid}/measures', json={'measures': []})
        self.assertEqual(r.status_code, 400)
        # 仍为草稿，未迁移
        self.assertEqual(
            self.query('SELECT status FROM reports WHERE id=?', (rid,))[0]['status'],
            'draft')


# ---------------------------------------------------------------------------
# 2. 我的任务 GET /api/measures/mine
# ---------------------------------------------------------------------------
class MyMeasuresTest(FlowApiBase):
    def test_fields_order_and_filters(self):
        rid, mids = self.make_executing(n_measures=2)
        # 截止时间乱序插入：mine 应按 deadline 升序
        self.exec_sql('UPDATE measures SET deadline=? WHERE id=?', ('2099-01-02', mids[0]))
        self.exec_sql('UPDATE measures SET deadline=? WHERE id=?', ('2099-01-01', mids[1]))
        # 他人措施不可见
        other_rid, other_mids = self.make_executing(n_measures=1, teacher='teacher02')
        # 已定级报告的措施不可见
        done_rid, done_mids = self.make_executing(n_measures=1)
        self.exec_sql("UPDATE reports SET status='concluded' WHERE id=?", (done_rid,))

        self.login('teacher01')
        r = self.client.get('/api/measures/mine')
        body = r.get_json()
        self.assertTrue(body['ok'], body)
        items = body['data']
        self.assertEqual([i['measure_id'] for i in items], [mids[1], mids[0]])
        expected_keys = {'measure_id', 'seq', 'content', 'verify_indicator', 'deadline',
                         'report_id', 'report_title', 'course_name', 'academic_year',
                         'term', 'report_status', 'achievement_status', 'returned_reason',
                         'achievement_id', 'achievement_content'}
        self.assertEqual(set(items[0].keys()), expected_keys)
        self.assertEqual(items[0]['report_status'], 'executing')
        self.assertEqual(items[0]['course_name'], '工程制图')
        self.assertEqual(items[0]['academic_year'], '2025-2026学年')
        self.assertEqual(items[0]['term'], '第一学期')
        self.assertIsNone(items[0]['achievement_status'])
        self.assertIsNone(items[0]['returned_reason'])
        self.assertIsNone(items[0]['achievement_id'])
        self.assertIsNone(items[0]['achievement_content'])
        self.assertNotIn(other_mids[0], [i['measure_id'] for i in items])
        self.assertNotIn(done_mids[0], [i['measure_id'] for i in items])

    def test_achievement_status_and_returned_reason(self):
        rid, mids = self.make_executing(n_measures=1)
        mid = mids[0]
        self.login('teacher01')
        self.assertTrue(self.submit_achievement(mid).get_json()['ok'])
        items = self.client.get('/api/measures/mine').get_json()['data']
        self.assertEqual(items[0]['achievement_status'], 'submitted')
        self.assertIsNone(items[0]['returned_reason'])
        # 负责人打回后：returned + 最新原因
        self.login('leader01')
        aid = self.achievement_id(mid)
        self.client.post(f'/api/achievements/{aid}/reject', json={'reason': '第一次不行'})
        # 已 returned 状态不能重复打回，最新原因即第一次
        r = self.client.post(f'/api/achievements/{aid}/reject', json={'reason': '第二次不行'})
        self.assertEqual(r.status_code, 400)
        self.login('teacher01')
        items = self.client.get('/api/measures/mine').get_json()['data']
        self.assertEqual(items[0]['achievement_status'], 'returned')
        self.assertEqual(items[0]['returned_reason'], '第一次不行')
        # 重提后原因不再显示（状态 submitted）
        self.assertTrue(self.submit_achievement(mid, '修改后内容').get_json()['ok'])
        items = self.client.get('/api/measures/mine').get_json()['data']
        self.assertEqual(items[0]['achievement_status'], 'submitted')
        self.assertIsNone(items[0]['returned_reason'])

    def test_requires_teacher_role(self):
        self.login('leader01')
        self.assertEqual(self.client.get('/api/measures/mine').status_code, 403)

    def test_non_creator_assignee_reads_own_content(self):
        # 责任人非报告创建者：mine 仍能读回自己提交的达成内容（无需 report_detail，
        # 解决跨教师 403 问题）
        rid = self.insert_report(teacher='teacher01', leader='leader01', status='executing')
        mid = self.insert_measure(rid, assignee='teacher02', deadline=FUTURE, status='assigned')
        self.login('teacher02')
        # teacher02 非创建者且为纯教师，report_detail 不可见
        self.assertEqual(self.client.get(f'/api/reports/{rid}').status_code, 403)
        self.assertIsNone(
            self.client.get('/api/measures/mine').get_json()['data'][0]['achievement_content'])
        self.assertTrue(self.submit_achievement(mid, '二号内容').get_json()['ok'])
        item = self.client.get('/api/measures/mine').get_json()['data'][0]
        self.assertEqual(item['achievement_status'], 'submitted')
        self.assertEqual(item['achievement_content'], '二号内容')
        self.assertEqual(item['achievement_id'], self.achievement_id(mid))


# ---------------------------------------------------------------------------
# 3. 按措施提交达成 POST /api/measures/<mid>/achievement
# ---------------------------------------------------------------------------
class AchievementSubmitTest(FlowApiBase):
    def test_assignee_submits_new_and_resubmits(self):
        rid, mids = self.make_executing(n_measures=1)
        mid = mids[0]
        self.login('teacher01')
        r = self.submit_achievement(mid, '首次达成内容')
        body = r.get_json()
        self.assertTrue(body['ok'], body)
        self.assertEqual(body['data']['status'], 'submitted')
        aid = body['data']['achievement_id']
        row = self.query('SELECT * FROM achievements WHERE id=?', (aid,))[0]
        self.assertEqual(row['measure_id'], mid)
        self.assertEqual(row['report_id'], rid)
        self.assertEqual(row['submitter_id'], self.uid('teacher01'))
        self.assertEqual(row['content'], '首次达成内容')
        # 重提：同一 achievement 覆盖 content，仍 submitted
        r = self.submit_achievement(mid, '修改后内容')
        self.assertEqual(r.get_json()['data']['achievement_id'], aid)
        rows = self.query('SELECT * FROM achievements WHERE measure_id=?', (mid,))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['content'], '修改后内容')
        self.assertEqual(rows[0]['status'], 'submitted')
        # 报告状态不动
        self.assertEqual(self.query(
            'SELECT status FROM reports WHERE id=?', (rid,))[0]['status'], 'executing')

    def test_non_assignee_forbidden(self):
        rid, mids = self.make_executing(n_measures=1, teacher='teacher02')
        self.login('teacher01')
        r = self.submit_achievement(mids[0])
        self.assertEqual(r.status_code, 403)
        self.assertEqual(len(self.query(
            'SELECT * FROM achievements WHERE measure_id=?', (mids[0],))), 0)

    def test_empty_content_rejected(self):
        rid, mids = self.make_executing(n_measures=1)
        self.login('teacher01')
        for content in ('', '   ', None):
            r = self.client.post(f'/api/measures/{mids[0]}/achievement',
                                 json={'content': content})
            self.assertEqual(r.status_code, 400)

    def test_report_not_executing_rejected(self):
        for status in ('draft', 'submitted', 'returned', 'concluded'):
            rid = self.insert_report(status=status)
            mid = self.insert_measure(rid, assignee='teacher01', deadline=FUTURE)
            self.login('teacher01')
            r = self.submit_achievement(mid)
            self.assertEqual(r.status_code, 400, status)
            self.assertIn('不允许提交达成报告', r.get_json()['error'])

    def test_past_deadline_rejected(self):
        rid, mids = self.make_executing(n_measures=1, deadline=PAST)
        self.login('teacher01')
        r = self.submit_achievement(mids[0])
        self.assertEqual(r.status_code, 400)
        self.assertIn('截止时间', r.get_json()['error'])

    def test_measure_missing_404(self):
        self.login('teacher01')
        self.assertEqual(
            self.client.post('/api/measures/9999/achievement',
                             json={'content': 'x'}).status_code, 404)

    def test_approved_achievement_cannot_resubmit(self):
        # 已 approved 的达成不得被重置回 submitted
        rid, mids = self.make_executing(n_measures=1)
        mid = mids[0]
        self.login('teacher01')
        aid = self.submit_achievement(mid, '首次内容').get_json()['data']['achievement_id']
        self.login('leader01')
        self.client.post(f'/api/achievements/{aid}/approve')
        self.login('teacher01')
        r = self.submit_achievement(mid, '试图覆盖')
        self.assertEqual(r.status_code, 400)
        self.assertIn('已通过审批', r.get_json()['error'])
        # 达成状态/内容未被改动
        row = self.query('SELECT status, content FROM achievements WHERE id=?', (aid,))[0]
        self.assertEqual(row['status'], 'approved')
        self.assertEqual(row['content'], '首次内容')


# ---------------------------------------------------------------------------
# 4. 逐份审批与打回循环 + 待审计数
# ---------------------------------------------------------------------------
class AchievementReviewTest(FlowApiBase):
    def test_approve_flow(self):
        rid, mids = self.make_executing(n_measures=1)
        mid = mids[0]
        self.login('teacher01')
        aid = self.submit_achievement(mid).get_json()['data']['achievement_id']
        self.login('leader01')
        r = self.client.post(f'/api/achievements/{aid}/approve')
        body = r.get_json()
        self.assertTrue(body['ok'], body)
        self.assertEqual(body['data'], {'id': aid, 'status': 'approved',
                                        'report_id': rid})
        self.assertEqual(self.query(
            'SELECT status FROM achievements WHERE id=?', (aid,))[0]['status'],
            'approved')
        # 报告状态不动
        self.assertEqual(self.query(
            'SELECT status FROM reports WHERE id=?', (rid,))[0]['status'], 'executing')
        # 非 submitted 再审批 400
        r = self.client.post(f'/api/achievements/{aid}/approve')
        self.assertEqual(r.status_code, 400)

    def test_reject_requires_reason_and_records_history(self):
        rid, mids = self.make_executing(n_measures=1)
        self.login('teacher01')
        aid = self.submit_achievement(mids[0]).get_json()['data']['achievement_id']
        self.login('leader01')
        r = self.client.post(f'/api/achievements/{aid}/reject', json={'reason': '  '})
        self.assertEqual(r.status_code, 400)
        r = self.client.post(f'/api/achievements/{aid}/reject', json={'reason': '数据不足'})
        body = r.get_json()
        self.assertTrue(body['ok'], body)
        self.assertEqual(body['data'], {'id': aid, 'status': 'returned'})
        rej = self.query(
            "SELECT * FROM rejections WHERE target_type='achievement' AND target_id=?",
            (aid,))
        self.assertEqual(len(rej), 1)
        self.assertEqual(rej[0]['reason'], '数据不足')
        # 报告状态不动，达成状态 returned
        self.assertEqual(self.query(
            'SELECT status FROM reports WHERE id=?', (rid,))[0]['status'], 'executing')
        self.assertEqual(self.query(
            'SELECT status FROM achievements WHERE id=?', (aid,))[0]['status'],
            'returned')
        # 打回后责任人重提 → returned → submitted
        self.login('teacher01')
        self.assertTrue(self.submit_achievement(mids[0], '补充数据后重提').get_json()['ok'])
        self.assertEqual(self.query(
            'SELECT status FROM achievements WHERE id=?', (aid,))[0]['status'],
            'submitted')

    def test_scope_check_other_leader_forbidden(self):
        rid, mids = self.make_executing(n_measures=1)
        self.login('teacher01')
        aid = self.submit_achievement(mids[0]).get_json()['data']['achievement_id']
        self.login('leader02')
        self.assertEqual(
            self.client.post(f'/api/achievements/{aid}/approve').status_code, 403)
        self.assertEqual(
            self.client.post(f'/api/achievements/{aid}/reject',
                             json={'reason': '不行'}).status_code, 403)

    def test_missing_achievement_404(self):
        self.login('leader01')
        self.assertEqual(
            self.client.post('/api/achievements/9999/approve').status_code, 404)
        self.assertEqual(
            self.client.post('/api/achievements/9999/reject',
                             json={'reason': 'x'}).status_code, 404)

    def test_pending_achievement_counters(self):
        rid, mids = self.make_executing(n_measures=2)
        # 无 submitted 达成且未全通过：不出现在待审列表
        self.login('leader01')
        data = self.client.get('/api/leader/pending').get_json()['data']
        self.assertEqual(data['pending_achievements'], [])
        # 一份 submitted：计数 1/2，approved_count=0，未可定级
        self.login('teacher01')
        self.submit_achievement(mids[0])
        self.login('leader01')
        data = self.client.get('/api/leader/pending').get_json()['data']
        self.assertEqual(len(data['pending_achievements']), 1)
        item = data['pending_achievements'][0]
        self.assertEqual(item['id'], rid)
        self.assertEqual(item['submitted_count'], 1)
        self.assertEqual(item['total_measures'], 2)
        self.assertEqual(item['approved_count'], 0)
        self.assertFalse(item['ready_to_conclude'])
        # 通过第一份：submitted 归零、approved_count=1，但另一份无达成→未全通过不可定级，
        # 因 submitted_count==0 且 not ready_to_conclude 暂不出现在列表
        aid0 = self.achievement_id(mids[0])
        self.client.post(f'/api/achievements/{aid0}/approve')
        data = self.client.get('/api/leader/pending').get_json()['data']
        self.assertEqual(data['pending_achievements'], [])
        # 第二份提交后：1 待审、1 已通过，仍不可定级
        self.login('teacher01')
        self.submit_achievement(mids[1])
        self.login('leader01')
        item = self.client.get('/api/leader/pending').get_json()['data']['pending_achievements'][0]
        self.assertEqual(item['submitted_count'], 1)
        self.assertEqual(item['approved_count'], 1)
        self.assertFalse(item['ready_to_conclude'])
        # 全部通过：submitted_count 归零，但 ready_to_conclude=True → 报告仍留在列表可定级
        self.client.post(f'/api/achievements/{self.achievement_id(mids[1])}/approve')
        data = self.client.get('/api/leader/pending').get_json()['data']
        self.assertEqual(len(data['pending_achievements']), 1)
        item = data['pending_achievements'][0]
        self.assertEqual(item['id'], rid)
        self.assertEqual(item['submitted_count'], 0)
        self.assertEqual(item['approved_count'], item['total_measures'])
        self.assertTrue(item['ready_to_conclude'])


# ---------------------------------------------------------------------------
# 5. 整体定级 POST /api/reports/<rid>/conclude
# ---------------------------------------------------------------------------
class ConcludeTest(FlowApiBase):
    def _all_approved(self, rid, mids):
        self.login('teacher01')
        for mid in mids:
            self.submit_achievement(mid)
        self.login('leader01')
        for mid in mids:
            self.client.post(f'/api/achievements/{self.achievement_id(mid)}/approve')

    def test_guard_blocks_until_all_approved(self):
        rid, mids = self.make_executing(n_measures=2)
        self.login('teacher01')
        self.submit_achievement(mids[0])
        self.login('leader01')
        r = self.client.post(f'/api/reports/{rid}/conclude',
                             json={'final_result': '已达成目标'})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.get_json()['error'], '仍有 2 条措施的达成报告未通过审批')
        # 一份通过一份待审：仍差 1 条
        self.client.post(f'/api/achievements/{self.achievement_id(mids[0])}/approve')
        r = self.client.post(f'/api/reports/{rid}/conclude',
                             json={'final_result': '已达成目标'})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.get_json()['error'], '仍有 1 条措施的达成报告未通过审批')

    def test_conclude_success_writes_conclusion(self):
        rid, mids = self.make_executing(n_measures=2)
        self._all_approved(rid, mids)
        r = self.client.post(f'/api/reports/{rid}/conclude',
                             json={'final_result': '基本达成目标'})
        body = r.get_json()
        self.assertTrue(body['ok'], body)
        self.assertEqual(body['data'], {'id': rid, 'status': 'concluded',
                                        'conclusion': '基本达成目标'})
        row = self.query(
            'SELECT status, conclusion, concluded_at FROM reports WHERE id=?', (rid,))[0]
        self.assertEqual(row['status'], 'concluded')
        self.assertEqual(row['conclusion'], '基本达成目标')
        self.assertTrue(row['concluded_at'])
        # 详情端点返回 conclusion / concluded_at
        detail = self.client.get(f'/api/reports/{rid}').get_json()['data']
        self.assertEqual(detail['conclusion'], '基本达成目标')
        self.assertTrue(detail['concluded_at'])
        # 已定级后不能再定级
        r = self.client.post(f'/api/reports/{rid}/conclude',
                             json={'final_result': '已达成目标'})
        self.assertEqual(r.status_code, 400)

    def test_invalid_final_result(self):
        rid, mids = self.make_executing(n_measures=1)
        self._all_approved(rid, mids)
        for bad in ('', '不存在的等级', None):
            r = self.client.post(f'/api/reports/{rid}/conclude',
                                 json={'final_result': bad})
            self.assertEqual(r.status_code, 400)
            self.assertIn('结论必须为', r.get_json()['error'])

    def test_concurrent_status_change_conditional_update(self):
        # 守卫通过后、UPDATE 前报告已被并发定级：条件 UPDATE rowcount=0
        rid, mids = self.make_executing(n_measures=1)
        self._all_approved(rid, mids)
        self.exec_sql(
            "UPDATE reports SET status='concluded', conclusion='已达成目标' WHERE id=?",
            (rid,))
        r = self.client.post(f'/api/reports/{rid}/conclude',
                             json={'final_result': '未达成目标'})
        self.assertEqual(r.status_code, 400)
        # 原结论未被覆盖
        row = self.query('SELECT conclusion FROM reports WHERE id=?', (rid,))[0]
        self.assertEqual(row['conclusion'], '已达成目标')

    def test_scope_and_role(self):
        rid, mids = self.make_executing(n_measures=1)
        self._all_approved(rid, mids)
        # 其他负责人不可定级
        self.login('leader02')
        self.assertEqual(
            self.client.post(f'/api/reports/{rid}/conclude',
                             json={'final_result': '已达成目标'}).status_code, 403)
        # 教师不可定级
        self.login('teacher01')
        self.assertEqual(
            self.client.post(f'/api/reports/{rid}/conclude',
                             json={'final_result': '已达成目标'}).status_code, 403)


# ---------------------------------------------------------------------------
# 6. 审批指派强校验 POST /api/reports/<rid>/approve
# ---------------------------------------------------------------------------
class ApproveValidationTest(FlowApiBase):
    def _submitted_with_measure(self):
        rid = self.insert_report(status='submitted')
        mid = self.insert_measure(rid)
        return rid, mid

    def _approve(self, rid, mid, assignee_id, deadline=FUTURE):
        return self.client.post(f'/api/reports/{rid}/approve', json={
            'assignments': [{'measure_id': mid, 'assignee_id': assignee_id}],
            'deadlines': {str(mid): deadline}})

    def test_approve_moves_to_executing(self):
        rid, mid = self._submitted_with_measure()
        self.login('leader01')
        r = self._approve(rid, mid, self.uid('teacher02'))
        body = r.get_json()
        self.assertTrue(body['ok'], body)
        self.assertEqual(body['data']['status'], 'executing')
        row = self.query(
            'SELECT status, assignee_id, deadline FROM measures WHERE id=?', (mid,))[0]
        self.assertEqual(row['assignee_id'], self.uid('teacher02'))
        self.assertEqual(row['deadline'], FUTURE)

    def test_assignee_must_be_enabled_teacher(self):
        rid, mid = self._submitted_with_measure()
        self.login('leader01')
        # 负责人角色不可作为责任人
        r = self._approve(rid, mid, self.uid('leader01'))
        self.assertEqual(r.status_code, 400)
        self.assertIn('责任人必须为教师', r.get_json()['error'])
        # 停用教师不可作为责任人
        r = self._approve(rid, mid, self.uid('disabled01'))
        self.assertEqual(r.status_code, 400)
        self.assertIn('停用', r.get_json()['error'])
        # 不存在的用户
        r = self._approve(rid, mid, 9999)
        self.assertEqual(r.status_code, 400)
        self.assertIn('不存在', r.get_json()['error'])
        # 报告状态未变
        self.assertEqual(self.query(
            'SELECT status FROM reports WHERE id=?', (rid,))[0]['status'], 'submitted')

    def test_missing_deadline_rejected(self):
        rid = self.insert_report(status='submitted')
        m1 = self.insert_measure(rid, seq=1)
        m2 = self.insert_measure(rid, seq=2)
        self.login('leader01')
        r = self.client.post(f'/api/reports/{rid}/approve', json={
            'assignments': [{'measure_id': m1, 'assignee_id': self.uid('teacher01')},
                            {'measure_id': m2, 'assignee_id': self.uid('teacher02')}],
            'deadlines': {str(m1): FUTURE}})
        self.assertEqual(r.status_code, 400)
        self.assertIn('截止时间', r.get_json()['error'])


# ---------------------------------------------------------------------------
# 7. 报告详情扩展 GET /api/reports/<rid>
# ---------------------------------------------------------------------------
class ReportDetailTest(FlowApiBase):
    def test_measures_nest_achievement(self):
        rid, mids = self.make_executing(n_measures=2)
        self.login('teacher01')
        self.submit_achievement(mids[0], '零号达成')
        aid0 = self.achievement_id(mids[0])
        self.login('leader01')
        self.client.post(f'/api/achievements/{aid0}/reject', json={'reason': '请补充数据'})
        # returned 状态不可直接通过，先由教师重提
        r = self.client.post(f'/api/achievements/{aid0}/approve')
        self.assertEqual(r.status_code, 400)
        self.login('teacher01')
        self.submit_achievement(mids[0], '补充后的达成')
        self.login('leader01')
        self.client.post(f'/api/achievements/{aid0}/approve')

        detail = self.client.get(f'/api/reports/{rid}').get_json()['data']
        self.assertEqual(detail['conclusion'], '')
        self.assertIsNone(detail['concluded_at'])
        by_id = {m['id']: m for m in detail['measures']}
        ach = by_id[mids[0]]['achievement']
        self.assertEqual(ach['id'], aid0)
        self.assertEqual(ach['status'], 'approved')
        self.assertEqual(ach['content'], '补充后的达成')
        self.assertEqual(ach['submitter_name'], '王老师')
        self.assertTrue(ach['submitted_at'])
        self.assertIsNone(ach['returned_reason'])
        # 未提交的措施 achievement 为 null
        self.assertIsNone(by_id[mids[1]]['achievement'])

    def test_returned_reason_in_detail(self):
        rid, mids = self.make_executing(n_measures=1)
        self.login('teacher01')
        self.submit_achievement(mids[0])
        aid = self.achievement_id(mids[0])
        self.login('leader01')
        self.client.post(f'/api/achievements/{aid}/reject', json={'reason': '内容空洞'})
        detail = self.client.get(f'/api/reports/{rid}').get_json()['data']
        ach = detail['measures'][0]['achievement']
        self.assertEqual(ach['status'], 'returned')
        self.assertEqual(ach['returned_reason'], '内容空洞')

    def test_achievement_rejections_merged_in_detail(self):
        # 本报告达成的打回记录并入 rejections（含 target_type='achievement'、measure_seq）
        rid, mids = self.make_executing(n_measures=1)
        self.login('teacher01')
        aid = self.submit_achievement(mids[0], '初稿').get_json()['data']['achievement_id']
        self.login('leader01')
        self.client.post(f'/api/achievements/{aid}/reject', json={'reason': '达成打回原因'})
        detail = self.client.get(f'/api/reports/{rid}').get_json()['data']
        ach_rejs = [x for x in detail['rejections'] if x['target_type'] == 'achievement']
        self.assertEqual(len(ach_rejs), 1)
        self.assertEqual(ach_rejs[0]['reason'], '达成打回原因')
        self.assertEqual(ach_rejs[0]['target_id'], aid)
        self.assertEqual(ach_rejs[0]['measure_seq'], 1)
        self.assertTrue(ach_rejs[0]['created_at'])


# ---------------------------------------------------------------------------
# 8. AI 配置端点 /api/admin/ai-config
# ---------------------------------------------------------------------------
class AiConfigApiTest(FlowApiBase):
    def test_non_admin_forbidden(self):
        self.login('teacher01')
        self.assertEqual(self.client.get('/api/admin/ai-config').status_code, 403)
        self.assertEqual(self.client.put('/api/admin/ai-config',
                                         json={'model': 'x'}).status_code, 403)
        self.assertEqual(
            self.client.post('/api/admin/ai-config/test').status_code, 403)

    def test_get_shape_no_plaintext_key(self):
        self.login('admin01')
        data = self.client.get('/api/admin/ai-config').get_json()['data']
        for field in ('enabled', 'api_key_set', 'api_key_masked', 'base_url',
                      'model', 'timeout', 'prompt', 'default_prompt',
                      'enable_thinking', 'effective_source'):
            self.assertIn(field, data)
        self.assertFalse(data['api_key_set'])
        self.assertEqual(data['api_key_masked'], '')
        self.assertEqual(data['prompt'], ai_config.DEFAULT_PROMPT)
        self.assertEqual(data['default_prompt'], ai_config.DEFAULT_PROMPT)
        self.assertEqual(data['effective_source']['api_key'], '')
        self.assertEqual(data['effective_source']['prompt'], 'default')
        # 思考模式默认关闭
        self.assertFalse(data['enable_thinking'])
        self.assertEqual(data['effective_source']['enable_thinking'], 'env')

    def test_put_enable_thinking_persists(self):
        self.login('admin01')
        data = self.client.put('/api/admin/ai-config',
                               json={'enable_thinking': True}).get_json()['data']
        self.assertTrue(data['enable_thinking'])
        self.assertEqual(data['effective_source']['enable_thinking'], 'db')
        self.assertEqual(self.query(
            "SELECT value FROM settings WHERE key='ai_enable_thinking'"
        )[0]['value'], '1')

        data = self.client.put('/api/admin/ai-config',
                               json={'enable_thinking': False}).get_json()['data']
        self.assertFalse(data['enable_thinking'])
        self.assertEqual(self.query(
            "SELECT value FROM settings WHERE key='ai_enable_thinking'"
        )[0]['value'], '0')

    def test_put_thinking_reaches_generator_body(self):
        # 后台开关最终体现在发往阿里云端点的请求体里
        self.login('admin01')
        self.client.put('/api/admin/ai-config', json={
            'enabled': True, 'api_key': 'sk-db', 'enable_thinking': True,
            'base_url': 'https://dashscope.aliyuncs.com/compatible-mode/v1'})
        rid = self.insert_report()
        payload = json.dumps({'measures': [
            {'content': '措施', 'verify_indicator': '指标'}]}, ensure_ascii=False)
        fake = _FakeResponse(json.dumps(
            {'choices': [{'message': {'role': 'assistant', 'content': payload}}]},
            ensure_ascii=False))
        self.login('teacher01')
        with mock.patch('urllib.request.urlopen', return_value=fake) as m:
            r = self.client.post(f'/api/reports/{rid}/generate')
        self.assertTrue(r.get_json()['ok'], r.get_json())
        body = json.loads(m.call_args[0][0].data.decode('utf-8'))
        self.assertIs(body['enable_thinking'], True)

    def test_put_key_masked_and_never_echoed(self):
        self.login('admin01')
        r = self.client.put('/api/admin/ai-config', json={
            'enabled': True, 'api_key': 'sk-super-secret',
            'base_url': 'https://my.ai/v1', 'model': 'my-model',
            'timeout': 8, 'prompt': '自定义提示词'})
        body = r.get_json()
        self.assertTrue(body['ok'], body)
        data = body['data']
        self.assertTrue(data['enabled'])
        self.assertTrue(data['api_key_set'])
        self.assertEqual(data['api_key_masked'], '******')
        self.assertEqual(data['base_url'], 'https://my.ai/v1')
        self.assertEqual(data['model'], 'my-model')
        self.assertEqual(data['timeout'], 8.0)
        self.assertEqual(data['prompt'], '自定义提示词')
        self.assertEqual(data['effective_source']['api_key'], 'db')
        # 响应与审计日志均不含明文密钥
        self.assertNotIn('sk-super-secret', r.get_data(as_text=True))
        logs = self.query(
            "SELECT detail FROM action_log WHERE action='修改 AI 配置'")
        self.assertTrue(logs)
        for row in logs:
            self.assertNotIn('sk-super-secret', row['detail'])
        # DB 中确实写入了密钥（可供解析使用）
        self.assertEqual(self.query(
            "SELECT value FROM settings WHERE key='ai_api_key'")[0]['value'],
            'sk-super-secret')

    def test_put_empty_key_does_not_overwrite(self):
        self.login('admin01')
        self.client.put('/api/admin/ai-config', json={'api_key': 'sk-first'})
        r = self.client.put('/api/admin/ai-config', json={'api_key': '  ',
                                                          'model': 'm2'})
        data = r.get_json()['data']
        self.assertTrue(data['api_key_set'])
        self.assertEqual(data['model'], 'm2')
        self.assertEqual(self.query(
            "SELECT value FROM settings WHERE key='ai_api_key'")[0]['value'],
            'sk-first')

    def test_put_clear_key_falls_back_to_env(self):
        self.login('admin01')
        self.client.put('/api/admin/ai-config', json={'api_key': 'sk-db'})
        with mock.patch.object(config, 'AI_API_KEY', 'sk-env'):
            r = self.client.put('/api/admin/ai-config', json={'clear_api_key': True})
            data = r.get_json()['data']
        self.assertTrue(data['api_key_set'])          # env 兜底仍算已设置
        self.assertEqual(data['effective_source']['api_key'], 'env')
        self.assertEqual(self.query(
            "SELECT value FROM settings WHERE key='ai_api_key'")[0]['value'], '')

    def test_put_timeout_validation(self):
        self.login('admin01')
        for bad in (0, -1, 'abc', None):
            r = self.client.put('/api/admin/ai-config', json={'timeout': bad})
            self.assertEqual(r.status_code, 400, bad)
            self.assertIn('正数', r.get_json()['error'])

    def test_put_no_fields_rejected(self):
        self.login('admin01')
        r = self.client.put('/api/admin/ai-config', json={})
        self.assertEqual(r.status_code, 400)

    def _enable_with_key(self, key='sk-test-key'):
        self.login('admin01')
        self.client.put('/api/admin/ai-config',
                        json={'enabled': True, 'api_key': key})

    def test_test_endpoint_requires_enabled_and_key(self):
        self.login('admin01')
        r = self.client.post('/api/admin/ai-config/test')
        self.assertEqual(r.status_code, 400)
        self.assertIn('未启用', r.get_json()['error'])
        # 启用但无任何密钥（env 也为空）：解析层强制未启用，提示先启用并配置
        with mock.patch.object(config, 'AI_API_KEY', ''):
            self.client.put('/api/admin/ai-config', json={'enabled': True})
            r = self.client.post('/api/admin/ai-config/test')
        self.assertEqual(r.status_code, 400)
        self.assertIn('未启用', r.get_json()['error'])

    def test_test_endpoint_success(self):
        self._enable_with_key()
        payload = json.dumps({'model': 'real-model', 'choices': [
            {'message': {'role': 'assistant', 'content': 'OK'}}]}, ensure_ascii=False)
        fake = _FakeResponse(payload)
        with mock.patch('urllib.request.urlopen', return_value=fake) as m:
            r = self.client.post('/api/admin/ai-config/test')
        body = r.get_json()
        self.assertTrue(body['ok'], body)
        self.assertEqual(body['data'], {'message': '连接成功', 'model': 'real-model'})
        # 最小请求体：model + 用户消息"回复OK"，超时上限 10 秒
        req = m.call_args[0][0]
        sent = json.loads(req.data.decode('utf-8'))
        self.assertEqual(sent['messages'], [{'role': 'user', 'content': '回复OK'}])
        self.assertLessEqual(m.call_args[1]['timeout'], 10)
        self.assertNotIn('sk-test-key', r.get_data(as_text=True))

    def test_test_endpoint_http_error_no_key_leak(self):
        self._enable_with_key('sk-leak-check')
        err = urllib.error.HTTPError(
            'https://x/chat/completions', 401, 'Unauthorized', {},
            io.BytesIO(b'{"error":{"message":"invalid api key"}}'))
        with mock.patch('urllib.request.urlopen', side_effect=err):
            r = self.client.post('/api/admin/ai-config/test')
        self.assertEqual(r.status_code, 400)
        text = r.get_data(as_text=True)
        self.assertIn('401', text)
        self.assertNotIn('sk-leak-check', text)
        # 原始错误体不得透传回前端（仅写服务端日志）
        self.assertNotIn('invalid api key', text)

    def test_test_endpoint_network_and_bad_format(self):
        self._enable_with_key()
        with mock.patch('urllib.request.urlopen',
                        side_effect=urllib.error.URLError('connection refused')):
            r = self.client.post('/api/admin/ai-config/test')
        self.assertEqual(r.status_code, 400)
        self.assertIn('无法连接', r.get_json()['error'])
        with mock.patch('urllib.request.urlopen',
                        return_value=_FakeResponse('<html>502</html>')):
            r = self.client.post('/api/admin/ai-config/test')
        self.assertEqual(r.status_code, 400)
        self.assertIn('响应格式异常', r.get_json()['error'])


# ---------------------------------------------------------------------------
# 9. 多责任人链路（teacher01 建报告 → leader 分别指派 teacher02/teacher03 →
#    各自 mine 只见自己那条并能读回 achievement_content → 各自提交 →
#    打回其一并重提 → 逐份 approve → conclude 成功）
# ---------------------------------------------------------------------------
class MultiAssigneeChainTest(FlowApiBase):
    def test_multi_assignee_full_chain(self):
        # 动态新增 teacher03（启用中教师）
        self.exec_sql(
            'INSERT INTO users (username, password_hash, real_name, is_teacher, '
            'is_leader, is_admin, is_disabled) VALUES (?, ?, ?, 1, 0, 0, 0)',
            ('teacher03', generate_password_hash(PASSWORD), '郑老师'))
        t2, t3 = self.uid('teacher02'), self.uid('teacher03')
        # teacher01 建报告（submitted）+ 两条措施
        rid = self.insert_report(teacher='teacher01', leader='leader01', status='submitted')
        m1 = self.insert_measure(rid, seq=1, content='措施一')
        m2 = self.insert_measure(rid, seq=2, content='措施二')
        # leader 审批：m1→teacher02、m2→teacher03
        self.login('leader01')
        r = self.client.post(f'/api/reports/{rid}/approve', json={
            'assignments': [{'measure_id': m1, 'assignee_id': t2},
                            {'measure_id': m2, 'assignee_id': t3}],
            'deadlines': {str(m1): FUTURE, str(m2): FUTURE}})
        self.assertTrue(r.get_json()['ok'], r.get_json())
        self.assertEqual(self.query(
            'SELECT status FROM reports WHERE id=?', (rid,))[0]['status'], 'executing')
        # 各自 mine 只见自己那条，初始无达成内容
        self.login('teacher02')
        items = self.client.get('/api/measures/mine').get_json()['data']
        self.assertEqual([i['measure_id'] for i in items], [m1])
        self.assertIsNone(items[0]['achievement_content'])
        self.login('teacher03')
        items = self.client.get('/api/measures/mine').get_json()['data']
        self.assertEqual([i['measure_id'] for i in items], [m2])
        # 各自提交达成
        self.login('teacher02')
        self.assertTrue(self.submit_achievement(m1, '二号达成内容').get_json()['ok'])
        self.login('teacher03')
        self.assertTrue(self.submit_achievement(m2, '三号达成内容').get_json()['ok'])
        # 责任人非创建者，mine 能读回自己的 achievement_content
        self.login('teacher02')
        item = self.client.get('/api/measures/mine').get_json()['data'][0]
        self.assertEqual(item['achievement_status'], 'submitted')
        self.assertEqual(item['achievement_content'], '二号达成内容')
        # leader 打回 m2，teacher03 重提
        self.login('leader01')
        self.client.post(f'/api/achievements/{self.achievement_id(m2)}/reject',
                         json={'reason': '需补充数据'})
        self.login('teacher03')
        item = self.client.get('/api/measures/mine').get_json()['data'][0]
        self.assertEqual(item['achievement_status'], 'returned')
        self.assertEqual(item['returned_reason'], '需补充数据')
        self.assertEqual(item['achievement_content'], '三号达成内容')
        self.assertTrue(self.submit_achievement(m2, '三号补充后').get_json()['ok'])
        # 逐份通过；先通过一份时 pending 仍有待审另一份
        self.login('leader01')
        self.client.post(f'/api/achievements/{self.achievement_id(m1)}/approve')
        data = self.client.get('/api/leader/pending').get_json()['data']
        self.assertEqual(len(data['pending_achievements']), 1)
        self.assertEqual(data['pending_achievements'][0]['approved_count'], 1)
        self.assertFalse(data['pending_achievements'][0]['ready_to_conclude'])
        self.client.post(f'/api/achievements/{self.achievement_id(m2)}/approve')
        data = self.client.get('/api/leader/pending').get_json()['data']
        self.assertTrue(data['pending_achievements'][0]['ready_to_conclude'])
        self.assertEqual(data['pending_achievements'][0]['approved_count'], 2)
        # 定级成功
        r = self.client.post(f'/api/reports/{rid}/conclude',
                             json={'final_result': '已达成目标'})
        self.assertTrue(r.get_json()['ok'], r.get_json())
        self.assertEqual(self.query(
            'SELECT status, conclusion FROM reports WHERE id=?', (rid,))[0]['status'],
            'concluded')


# ---------------------------------------------------------------------------
# 10. 批量导入新写入（importer 适配新结构）
# ---------------------------------------------------------------------------
class ImporterNewSchemaTest(FlowApiBase):
    CSV = ('\ufeff教师工号,课程代码,学年,学期,报告标题,措施内容,验证指标,结论\n'
           'teacher01,GCTZ1001,2025-2026学年,第一学期,历史报告,加强练习,达成度0.8,基本达成目标\n')

    def _import(self):
        self.login('leader01')
        return self.client.post(
            '/api/import',
            data={'file': (io.BytesIO(self.CSV.encode('utf-8')), '历史.csv')},
            content_type='multipart/form-data')

    def test_import_writes_new_schema(self):
        r = self._import()
        body = r.get_json()
        self.assertTrue(body['ok'], body)
        self.assertEqual(body['data']['success_rows'], 1)
        report = self.query("SELECT * FROM reports WHERE source='import'")[0]
        self.assertEqual(report['status'], 'concluded')
        self.assertEqual(report['conclusion'], '基本达成目标')
        self.assertTrue(report['concluded_at'])
        measure = self.query(
            'SELECT * FROM measures WHERE report_id=?', (report['id'],))[0]
        self.assertEqual(measure['assignee_id'], self.uid('teacher01'))
        ach = self.query(
            'SELECT * FROM achievements WHERE report_id=?', (report['id'],))[0]
        self.assertEqual(ach['measure_id'], measure['id'])
        self.assertEqual(ach['submitter_id'], self.uid('teacher01'))
        self.assertEqual(ach['status'], 'approved')
        self.assertEqual(ach['content'], '加强练习')
        self.assertTrue(ach['submitted_at'])

    def test_imported_report_detail(self):
        self._import()
        report = self.query("SELECT * FROM reports WHERE source='import'")[0]
        self.login('leader01')
        detail = self.client.get(f"/api/reports/{report['id']}").get_json()['data']
        self.assertEqual(detail['conclusion'], '基本达成目标')
        ach = detail['measures'][0]['achievement']
        self.assertEqual(ach['status'], 'approved')
        self.assertEqual(ach['submitter_name'], '王老师')


if __name__ == '__main__':
    unittest.main()
