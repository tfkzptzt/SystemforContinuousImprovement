# -*- coding: utf-8 -*-
"""AI 配置解析：settings 表(DB) > 环境变量 > 默认值

设计要点：
1. resolve(get_db_row) 为纯函数式解析——调用方传入"按键查 settings 行"的取数函数，
   便于在无 Flask 请求上下文（测试、脚本）时复用；
2. API Key 只写不读：任何接口/日志不回显明文，GET 仅返回 api_key_set 布尔与掩码；
3. ai_enabled：DB 有值（'0'/'1'）时以 DB 为准；否则回退"环境变量 AI_API_KEY 非空即启用"；
4. ai_timeout：容错解析（非法值回落默认），默认取 config.AI_TIMEOUT（env，缺省 20.0）；
5. ai_prompt：系统提示词模板，DB 非空 > DEFAULT_PROMPT（原 ai_generator 内置提示词）。
"""
import config

# settings 表键 → 配置字段映射（解析结果字典的键名）
SETTINGS_KEYS = ('ai_enabled', 'ai_api_key', 'ai_base_url', 'ai_model',
                 'ai_timeout', 'ai_prompt')

# 默认系统提示词（迁移自 ai_generator 原内置 _SYSTEM_PROMPT）
DEFAULT_PROMPT = (
    '你是高校课程持续改进专家。请从课程考核报告中提炼改进措施，'
    '每条措施须配一个可量化的次年验证指标。'
    '只输出 JSON，不要输出任何解释或多余文字，格式为：'
    '{"measures": [{"content": "改进措施内容", "verify_indicator": "次年验证指标"}]}。'
    '共 3-6 条；措施须具体可执行，不得直接照抄章节标题或问题描述原文。'
)

# API Key 掩码（GET 接口对已设置密钥的展示形态）
KEY_MASK = '******'


def mask_api_key(key):
    """已设置返回掩码 '******'，未设置返回空串（绝不返回明文）。"""
    return KEY_MASK if (key or '').strip() else ''


def _db_value(get_db_row, key):
    """读 settings 表某键的值，行不存在/值为空均返回 None（视为 DB 未配置）。"""
    row = get_db_row(key)
    if row is None:
        return None
    try:
        value = row['value']
    except (KeyError, IndexError, TypeError):
        return None
    value = (value or '').strip()
    return value or None


def _parse_timeout(raw, default):
    """容错解析超时秒数：非数字/≤0 回落默认（与 config._parse_ai_timeout 同策略）。"""
    try:
        val = float(str(raw).strip())
    except (TypeError, ValueError):
        return default
    return val if val > 0 else default


def resolve(get_db_row):
    """按 DB 非空 > 环境变量 > 默认值解析 AI 配置。

    :param get_db_row: 函数 (key) -> settings 行（含 'value' 列）或 None
    :return: {'enabled': bool, 'api_key': str, 'base_url': str, 'model': str,
              'timeout': float, 'prompt': str, 'source': {键: 'db'|'env'|''}}
              source 记录各键生效来源（'' 表示 DB/env 均未配置，走默认值）。
    """
    db_enabled = _db_value(get_db_row, 'ai_enabled')
    db_key = _db_value(get_db_row, 'ai_api_key')
    db_base_url = _db_value(get_db_row, 'ai_base_url')
    db_model = _db_value(get_db_row, 'ai_model')
    db_timeout = _db_value(get_db_row, 'ai_timeout')
    db_prompt = _db_value(get_db_row, 'ai_prompt')

    env_key = (config.AI_API_KEY or '').strip()

    api_key = db_key or env_key
    base_url = db_base_url or config.AI_BASE_URL
    model = db_model or config.AI_MODEL
    prompt = db_prompt or DEFAULT_PROMPT

    # enabled：DB 有值以 DB 为准；否则回退"环境变量 AI_API_KEY 非空即启用"
    if db_enabled is not None:
        enabled = db_enabled == '1'
    else:
        enabled = bool(env_key)
    # 未解析出任何密钥时强制视为未启用（无 Key 必然调用失败，直接走规则引擎）
    if not api_key:
        enabled = False

    timeout = _parse_timeout(db_timeout or '', config.AI_TIMEOUT)

    source = {
        'enabled': 'db' if db_enabled is not None else ('env' if env_key else ''),
        'api_key': 'db' if db_key else ('env' if env_key else ''),
        'base_url': 'db' if db_base_url else 'env',
        'model': 'db' if db_model else 'env',
        'timeout': 'db' if db_timeout else 'env',
        'prompt': 'db' if db_prompt else 'default',
    }
    return {'enabled': enabled, 'api_key': api_key, 'base_url': base_url,
            'model': model, 'timeout': timeout, 'prompt': prompt,
            'source': source}


def resolve_from_db(db):
    """请求上下文便捷封装：从 get_db() 连接解析配置。"""
    def get_db_row(key):
        return db.execute('SELECT value FROM settings WHERE key=?', (key,)).fetchone()
    return resolve(get_db_row)
