# -*- coding: utf-8 -*-
"""AI 措施生成单元测试：配置解析、响应解析、启用判定、AI 优先+规则兜底编排（全程不触真实网络）"""
import io
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config  # noqa: E402
from werkzeug.security import generate_password_hash  # noqa: E402

from services import ai_config, ai_generator  # noqa: E402
from services.ai_generator import AiGeneratorError, parse_measures  # noqa: E402
from services.measure_generator import FALLBACK_MEASURE, MAX_MEASURES  # noqa: E402


def _resp(content):
    """构造最小 /chat/completions 响应体（dict），content 为 message.content 字符串"""
    return {'choices': [{'message': {'role': 'assistant', 'content': content}}]}


def _settings(**over):
    """构造 ai_config.resolve 形态的配置字典（测试默认：启用 + 测试密钥）"""
    base = {'enabled': True, 'api_key': 'sk-test',
            'base_url': config.AI_BASE_URL, 'model': config.AI_MODEL,
            'timeout': config.AI_TIMEOUT, 'prompt': ai_config.DEFAULT_PROMPT,
            'source': {}}
    base.update(over)
    return base


# ---------------------------------------------------------------------------
# 1. 解析逻辑（纯函数，无网络无 DB）
# ---------------------------------------------------------------------------
class ParseMeasuresTest(unittest.TestCase):
    def test_normal_measures_object(self):
        content = json.dumps({'measures': [
            {'content': '加强习题课讲评', 'verify_indicator': '次年达成度不低于0.8'},
            {'content': '引入错题归因分析', 'verify_indicator': '期末得分率提升5%'},
        ]}, ensure_ascii=False)
        items = parse_measures(_resp(content))
        self.assertEqual(len(items), 2)
        self.assertEqual(items[0]['content'], '加强习题课讲评')
        self.assertEqual(items[1]['verify_indicator'], '期末得分率提升5%')

    def test_bare_array_form(self):
        content = json.dumps([
            {'content': '措施A', 'verify_indicator': '指标A'},
        ], ensure_ascii=False)
        items = parse_measures(_resp(content))
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]['content'], '措施A')

    def test_json_code_fence_wrapped(self):
        inner = json.dumps({'measures': [
            {'content': '措施B', 'verify_indicator': '指标B'}]}, ensure_ascii=False)
        content = '```json\n' + inner + '\n```'
        items = parse_measures(_resp(content))
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]['content'], '措施B')

    def test_plain_code_fence_wrapped(self):
        inner = json.dumps([{'content': '措施C', 'verify_indicator': '指标C'}],
                           ensure_ascii=False)
        content = '```\n' + inner + '\n```'
        items = parse_measures(_resp(content))
        self.assertEqual(items[0]['content'], '措施C')

    def test_missing_verify_indicator_uses_fallback(self):
        content = json.dumps({'measures': [
            {'content': '仅有措施内容'},
            {'content': '空指标', 'verify_indicator': '   '},
        ]}, ensure_ascii=False)
        items = parse_measures(_resp(content))
        self.assertEqual(len(items), 2)
        for it in items:
            self.assertEqual(it['verify_indicator'], FALLBACK_MEASURE['verify_indicator'])

    def test_filters_empty_and_invalid_items(self):
        content = json.dumps({'measures': [
            {'content': '   '},                 # 空内容过滤
            {'content': 123},                   # 非字符串过滤
            'not-a-dict',                       # 非对象过滤
            {'content': '有效措施', 'verify_indicator': '有效指标'},
        ]}, ensure_ascii=False)
        items = parse_measures(_resp(content))
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]['content'], '有效措施')

    def test_truncates_to_max_measures(self):
        many = [{'content': f'措施{i}', 'verify_indicator': f'指标{i}'}
                for i in range(MAX_MEASURES + 4)]
        content = json.dumps({'measures': many}, ensure_ascii=False)
        items = parse_measures(_resp(content))
        self.assertEqual(len(items), MAX_MEASURES)

    def test_empty_array_raises(self):
        with self.assertRaises(AiGeneratorError):
            parse_measures(_resp(json.dumps({'measures': []})))

    def test_all_invalid_raises(self):
        content = json.dumps({'measures': [{'content': ''}]}, ensure_ascii=False)
        with self.assertRaises(AiGeneratorError):
            parse_measures(_resp(content))

    def test_not_json_content_raises(self):
        with self.assertRaises(AiGeneratorError):
            parse_measures(_resp('这不是 JSON'))

    def test_missing_choices_raises(self):
        with self.assertRaises(AiGeneratorError):
            parse_measures({'error': 'boom'})

    def test_no_measures_key_raises(self):
        with self.assertRaises(AiGeneratorError):
            parse_measures(_resp(json.dumps({'foo': 'bar'})))

    def test_top_level_not_dict_raises(self):
        # 顶层非 dict（如裸数组/字符串）
        for bad in (['x'], 'plain-string', 123):
            with self.assertRaises(AiGeneratorError):
                parse_measures(bad)

    def test_empty_code_fence_raises(self):
        # ```json 围栏内为空
        with self.assertRaises(AiGeneratorError):
            parse_measures(_resp('```json\n\n```'))

    def test_json_scalar_raises(self):
        # JSON 标量（非对象非数组）
        with self.assertRaises(AiGeneratorError):
            parse_measures(_resp('123'))

    def test_content_not_string_raises(self):
        # message.content 为真值非字符串（list/int），应抛 AiGeneratorError 而非 AttributeError
        for bad in ([{'content': 'x'}], 123, {'a': 1}):
            resp = {'choices': [{'message': {'content': bad}}]}
            with self.assertRaises(AiGeneratorError):
                parse_measures(resp)


# ---------------------------------------------------------------------------
# 2. is_enabled 判定（基于解析后的 settings）
# ---------------------------------------------------------------------------
class IsEnabledTest(unittest.TestCase):
    def test_disabled_flag(self):
        self.assertFalse(ai_generator.is_enabled(_settings(enabled=False)))

    def test_empty_key_disabled(self):
        self.assertFalse(ai_generator.is_enabled(_settings(api_key='')))

    def test_blank_key_disabled(self):
        self.assertFalse(ai_generator.is_enabled(_settings(api_key='   ')))

    def test_enabled_with_key(self):
        self.assertTrue(ai_generator.is_enabled(_settings()))


# ---------------------------------------------------------------------------
# 2.5 ai_config.resolve 解析优先级（DB 非空 > 环境变量 > 默认）与掩码
# ---------------------------------------------------------------------------
def _row_getter(rows):
    """由 {key: value} 构造 get_db_row（返回含 'value' 键的 dict，缺键返回 None）"""
    return lambda key: {'value': rows[key]} if key in rows else None


class AiConfigResolveTest(unittest.TestCase):
    def test_defaults_from_env_when_db_empty(self):
        with mock.patch.object(config, 'AI_API_KEY', 'sk-env'):
            s = ai_config.resolve(_row_getter({}))
        self.assertTrue(s['enabled'])
        self.assertEqual(s['api_key'], 'sk-env')
        self.assertEqual(s['base_url'], config.AI_BASE_URL)
        self.assertEqual(s['model'], config.AI_MODEL)
        self.assertEqual(s['timeout'], config.AI_TIMEOUT)
        self.assertEqual(s['prompt'], ai_config.DEFAULT_PROMPT)
        self.assertEqual(s['source']['api_key'], 'env')
        self.assertEqual(s['source']['prompt'], 'default')

    def test_db_overrides_env(self):
        rows = {'ai_api_key': 'sk-db', 'ai_base_url': 'https://db.example/v1',
                'ai_model': 'db-model', 'ai_timeout': '5', 'ai_prompt': 'DB提示词'}
        with mock.patch.object(config, 'AI_API_KEY', 'sk-env'):
            s = ai_config.resolve(_row_getter(rows))
        self.assertEqual(s['api_key'], 'sk-db')
        self.assertEqual(s['base_url'], 'https://db.example/v1')
        self.assertEqual(s['model'], 'db-model')
        self.assertEqual(s['timeout'], 5.0)
        self.assertEqual(s['prompt'], 'DB提示词')
        for key in ('api_key', 'base_url', 'model', 'timeout', 'prompt'):
            self.assertEqual(s['source'][key], 'db')

    def test_db_blank_values_fall_back_to_env(self):
        rows = {'ai_api_key': '   ', 'ai_model': ''}
        with mock.patch.object(config, 'AI_API_KEY', 'sk-env'):
            s = ai_config.resolve(_row_getter(rows))
        self.assertEqual(s['api_key'], 'sk-env')
        self.assertEqual(s['model'], config.AI_MODEL)
        self.assertEqual(s['source']['api_key'], 'env')

    def test_enabled_db_takes_precedence(self):
        with mock.patch.object(config, 'AI_API_KEY', 'sk-env'):
            # DB 显式关闭：即使 env 有密钥也不启用
            s = ai_config.resolve(_row_getter({'ai_enabled': '0'}))
            self.assertFalse(s['enabled'])
            self.assertEqual(s['source']['enabled'], 'db')
            # DB 显式开启 + DB 密钥
            s = ai_config.resolve(_row_getter({'ai_enabled': '1', 'ai_api_key': 'sk-db'}))
            self.assertTrue(s['enabled'])

    def test_no_key_anywhere_forces_disabled(self):
        with mock.patch.object(config, 'AI_API_KEY', ''):
            s = ai_config.resolve(_row_getter({}))
            self.assertFalse(s['enabled'])
            self.assertEqual(s['api_key'], '')
            self.assertEqual(s['source']['api_key'], '')
            # DB 开了开关但无任何密钥：仍强制未启用
            s = ai_config.resolve(_row_getter({'ai_enabled': '1'}))
            self.assertFalse(s['enabled'])

    def test_invalid_timeout_falls_back(self):
        for bad in ('abc', '-3', '0'):
            s = ai_config.resolve(_row_getter({'ai_timeout': bad}))
            self.assertEqual(s['timeout'], config.AI_TIMEOUT)

    def test_mask_api_key(self):
        self.assertEqual(ai_config.mask_api_key('sk-secret'), '******')
        self.assertEqual(ai_config.mask_api_key(''), '')
        self.assertEqual(ai_config.mask_api_key(None), '')
        self.assertEqual(ai_config.mask_api_key('   '), '')


# ---------------------------------------------------------------------------
# 3. 文本截断
# ---------------------------------------------------------------------------
class TruncateTest(unittest.TestCase):
    def test_short_text_unchanged(self):
        self.assertEqual(ai_generator._truncate('短文本'), '短文本')

    def test_long_text_truncated_with_marker(self):
        text = 'x' * (ai_generator.MAX_INPUT_CHARS + 100)
        out = ai_generator._truncate(text)
        self.assertTrue(out.endswith(ai_generator._TRUNCATED_SUFFIX))
        self.assertEqual(len(out),
                         ai_generator.MAX_INPUT_CHARS + len(ai_generator._TRUNCATED_SUFFIX))


# ---------------------------------------------------------------------------
# 4. generate_measures 网络异常转 AiGeneratorError（mock urlopen，不触网）
# ---------------------------------------------------------------------------
class GenerateNetworkTest(unittest.TestCase):
    def test_disabled_raises(self):
        with self.assertRaises(AiGeneratorError):
            ai_generator.generate_measures('任意文本', _settings(enabled=False))
        with self.assertRaises(AiGeneratorError):
            ai_generator.generate_measures('任意文本', _settings(api_key=''))

    def test_network_error_raises_ai_error(self):
        with mock.patch('urllib.request.urlopen',
                        side_effect=OSError('connection refused')):
            with self.assertRaises(AiGeneratorError) as ctx:
                ai_generator.generate_measures('报告正文', _settings(api_key='sk-test'))
        # 异常信息不得泄露 API Key
        self.assertNotIn('sk-test', str(ctx.exception))

    def test_http_error_message_excludes_key(self):
        with mock.patch('urllib.request.urlopen',
                        side_effect=ValueError('bad status')):
            with self.assertRaises(AiGeneratorError) as ctx:
                ai_generator.generate_measures('报告正文',
                                               _settings(api_key='sk-secret-key'))
        self.assertNotIn('sk-secret-key', str(ctx.exception))

    def test_success_flow_parses(self):
        payload = json.dumps({'measures': [
            {'content': 'AI措施', 'verify_indicator': 'AI指标'}]}, ensure_ascii=False)
        fake = _FakeResponse(json.dumps(_resp(payload), ensure_ascii=False))
        with mock.patch('urllib.request.urlopen', return_value=fake):
            items = ai_generator.generate_measures('报告正文', _settings())
        self.assertEqual(items, [{'content': 'AI措施', 'verify_indicator': 'AI指标'}])

    def test_settings_prompt_and_model_used(self):
        # 系统提示词/模型/超时均取自 settings（非内置常量）
        payload = json.dumps({'measures': [
            {'content': '措施', 'verify_indicator': '指标'}]}, ensure_ascii=False)
        fake = _FakeResponse(json.dumps(_resp(payload), ensure_ascii=False))
        with mock.patch('urllib.request.urlopen', return_value=fake) as m:
            ai_generator.generate_measures('正文', _settings(
                prompt='自定义提示词', model='custom-model',
                base_url='https://custom.example/v1', timeout=7))
        req = m.call_args[0][0]
        body = json.loads(req.data.decode('utf-8'))
        self.assertEqual(body['model'], 'custom-model')
        self.assertEqual(body['messages'][0]['content'], '自定义提示词')
        self.assertEqual(req.full_url, 'https://custom.example/v1/chat/completions')
        self.assertEqual(req.get_header('Authorization'), 'Bearer sk-test')
        self.assertEqual(m.call_args[1]['timeout'], 7)

    def test_invalid_response_body_raises(self):
        # 响应体本身非法 JSON（如网关返回 HTML 502 页面）
        fake = _FakeResponse('<html><head><title>502 Bad Gateway</title></head></html>')
        with mock.patch('urllib.request.urlopen', return_value=fake):
            with self.assertRaises(AiGeneratorError):
                ai_generator.generate_measures('报告正文', _settings())

    def test_output_length_truncated(self):
        # 单条 content / verify_indicator 超 500 字被截断
        long = 'x' * (ai_generator.MAX_ITEM_CHARS + 100)
        payload = json.dumps({'measures': [
            {'content': long, 'verify_indicator': long}]}, ensure_ascii=False)
        fake = _FakeResponse(json.dumps(_resp(payload), ensure_ascii=False))
        with mock.patch('urllib.request.urlopen', return_value=fake):
            items = ai_generator.generate_measures('报告正文', _settings())
        self.assertEqual(len(items[0]['content']), ai_generator.MAX_ITEM_CHARS)
        self.assertEqual(len(items[0]['verify_indicator']), ai_generator.MAX_ITEM_CHARS)


class _FakeResponse(io.BytesIO):
    """模拟 urlopen 返回的响应对象（支持上下文管理器 + read()）"""

    def __init__(self, text):
        super().__init__(text.encode('utf-8'))

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
        return False


# ---------------------------------------------------------------------------
# 5. 端点编排：AI 优先 + 规则兜底（Flask test client + 临时 DB）
# ---------------------------------------------------------------------------
PASSWORD = '123456'
REPORT_TEXT = '一、存在问题。\n1. 加强模型教学与空间想象训练。次年验证指标：达成度不低于0.8。\n'


class OrchestrationTest(unittest.TestCase):
    def setUp(self):
        # 保存原全局配置，tearDown 还原，避免污染同进程后续测试模块
        self._orig_database = config.DATABASE
        self._orig_upload_dir = config.UPLOAD_DIR
        self._orig_ratelimit = config.RATELIMIT_ENABLED
        config.RATELIMIT_ENABLED = False  # 关闭登录限速，避免共享内存限速器累计触发 429
        self._tmpdir = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        config.DATABASE = os.path.join(self._tmpdir.name, 'orch.db')
        config.UPLOAD_DIR = os.path.join(self._tmpdir.name, 'uploads')
        for suffix in ('', '-wal', '-shm'):
            p = config.DATABASE + suffix
            if os.path.exists(p):
                os.remove(p)
        import db as db_mod
        db_mod.init_db()
        conn = self._conn()
        try:
            conn.execute(
                'INSERT INTO users (username, password_hash, real_name, is_teacher, '
                'is_leader, is_admin, is_disabled) VALUES (?, ?, ?, 1, 0, 0, 0)',
                ('teacher01', generate_password_hash(PASSWORD), '王老师'))
            conn.execute("INSERT INTO academic_years (name) VALUES ('2025-2026学年')")
            conn.execute(
                'INSERT INTO courses (name, code, academic_year, term, start_date, '
                "end_date, leader_id) VALUES ('工程制图', 'GCTZ1001', '2025-2026学年', "
                "'第一学期', '2025-09-01', '2025-12-31', NULL)")
            conn.execute(
                'INSERT INTO reports (teacher_id, course_id, leader_id, title, '
                'content_text, status, source, created_at, updated_at) '
                "VALUES (1, 1, NULL, '报告', ?, 'draft', 'upload', "
                "'2025-09-01 00:00:00', '2025-09-01 00:00:00')", (REPORT_TEXT,))
            conn.commit()
        finally:
            conn.close()
        from app import create_app
        self.app = create_app()
        self.app.config['TESTING'] = True
        self.client = self.app.test_client()
        self.client.post('/api/auth/login',
                         json={'username': 'teacher01', 'password': PASSWORD})

    def tearDown(self):
        # 还原全局配置并清理临时目录/文件
        config.DATABASE = self._orig_database
        config.UPLOAD_DIR = self._orig_upload_dir
        config.RATELIMIT_ENABLED = self._orig_ratelimit
        self._tmpdir.cleanup()

    def _conn(self):
        conn = sqlite3.connect(config.DATABASE)
        conn.row_factory = sqlite3.Row
        conn.execute('PRAGMA foreign_keys=ON')
        return conn

    def _generate(self):
        return self.client.post('/api/reports/1/generate')

    def _source_and_count(self):
        conn = self._conn()
        try:
            row = conn.execute(
                "SELECT detail FROM action_log WHERE action='生成改进措施' "
                'ORDER BY id DESC LIMIT 1').fetchone()
            measures = conn.execute(
                'SELECT content, verify_indicator FROM measures '
                'WHERE report_id=1 ORDER BY seq').fetchall()
        finally:
            conn.close()
        detail = json.loads(row['detail'])
        return detail, [dict(m) for m in measures]

    def _reset_report(self):
        conn = self._conn()
        try:
            conn.execute("UPDATE reports SET status='draft' WHERE id=1")
            conn.execute('DELETE FROM measures WHERE report_id=1')
            conn.execute("DELETE FROM action_log WHERE action='生成改进措施'")
            conn.commit()
        finally:
            conn.close()

    def _set_setting(self, key, value):
        conn = self._conn()
        try:
            conn.execute(
                'INSERT INTO settings (key, value) VALUES (?, ?) '
                'ON CONFLICT(key) DO UPDATE SET value=excluded.value', (key, value))
            conn.commit()
        finally:
            conn.close()

    def test_not_enabled_uses_rule_without_network(self):
        # 未配置 Key：不调用 urlopen，直接规则引擎，不写 generate_source
        with mock.patch.object(config, 'AI_API_KEY', ''):
            with mock.patch('urllib.request.urlopen') as m:
                r = self._generate()
        self.assertTrue(r.get_json()['ok'], r.get_json())
        m.assert_not_called()
        detail, measures = self._source_and_count()
        self.assertNotIn('generate_source', detail)
        self.assertGreaterEqual(len(measures), 1)

    def test_db_disabled_overrides_env_key(self):
        # settings 表 ai_enabled='0'：即使环境变量有密钥也走规则引擎（DB 优先）
        self._reset_report()
        self._set_setting('ai_enabled', '0')
        with mock.patch.object(config, 'AI_API_KEY', 'sk-test'):
            with mock.patch('urllib.request.urlopen') as m:
                r = self._generate()
        self.assertTrue(r.get_json()['ok'], r.get_json())
        m.assert_not_called()
        detail, _ = self._source_and_count()
        self.assertNotIn('generate_source', detail)

    def test_db_key_enables_ai_without_env(self):
        # settings 表写入密钥：环境变量无密钥时仍启用 AI（DB 优先）；
        # 类内共享库，显式置 ai_enabled='1' 避免前一用例写入的 '0' 干扰
        self._reset_report()
        self._set_setting('ai_enabled', '1')
        self._set_setting('ai_api_key', 'sk-db-only')
        payload = json.dumps({'measures': [
            {'content': 'DB密钥措施', 'verify_indicator': 'DB密钥指标'}]},
            ensure_ascii=False)
        fake = _FakeResponse(json.dumps(_resp(payload), ensure_ascii=False))
        with mock.patch.object(config, 'AI_API_KEY', ''):
            with mock.patch('urllib.request.urlopen', return_value=fake) as m:
                r = self._generate()
        self.assertTrue(r.get_json()['ok'], r.get_json())
        req = m.call_args[0][0]
        self.assertEqual(req.get_header('Authorization'), 'Bearer sk-db-only')
        detail, measures = self._source_and_count()
        self.assertEqual(detail.get('generate_source'), 'ai')
        self.assertEqual(measures[0]['content'], 'DB密钥措施')

    def test_ai_success_uses_ai_source(self):
        self._reset_report()
        payload = json.dumps({'measures': [
            {'content': 'AI生成措施', 'verify_indicator': 'AI验证指标'}]},
            ensure_ascii=False)
        fake = _FakeResponse(json.dumps(_resp(payload), ensure_ascii=False))
        with mock.patch.object(config, 'AI_API_KEY', 'sk-test'):
            with mock.patch('urllib.request.urlopen', return_value=fake):
                r = self._generate()
        self.assertTrue(r.get_json()['ok'], r.get_json())
        detail, measures = self._source_and_count()
        self.assertEqual(detail.get('generate_source'), 'ai')
        self.assertEqual(measures[0]['content'], 'AI生成措施')

    def test_ai_failure_falls_back_to_rule(self):
        self._reset_report()
        with mock.patch.object(config, 'AI_API_KEY', 'sk-test'):
            with mock.patch('urllib.request.urlopen',
                            side_effect=OSError('network down')):
                r = self._generate()
        # 降级：响应仍成功，结构不变；不写 generate_source
        self.assertEqual(r.status_code, 200)
        body = r.get_json()
        self.assertTrue(body['ok'], body)
        self.assertIsInstance(body['data'], list)
        detail, measures = self._source_and_count()
        self.assertNotIn('generate_source', detail)
        self.assertGreaterEqual(len(measures), 1)


if __name__ == '__main__':
    unittest.main()
