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
    '你是高校课程持续改进与工程教育认证专家，熟悉 OBE 理念、课程目标达成度评价'
    '与毕业要求指标点支撑关系。\n'
    '任务：依据【课程信息】与【报告正文】，为下一学年提出可落地、可核查的改进措施。\n\n'
    '每条措施必须同时具备三要素，缺一不可：\n'
    '1) 针对的问题——对应报告中明确写出的短板，须引用其达成度数值、考核环节、'
    '题号、指标点或具体教学现象，不得凭空概括；\n'
    '2) 具体做法——写清改进的教学环节与载体，例如增设几次何种课内实践或习题课、'
    '调整哪个考核环节的权重与评分细则、引入何种资源或工具、由何种角色承担，'
    '不能只说"加强""提高""重视""完善"；\n'
    '3) 完成时限——落实到具体学期或时间节点。\n\n'
    'verify_indicator（次年验证指标）必须可量化核查，须写明：'
    '指标名称 + 目标数值 + 数据来源与统计口径'
    '（如期末考试第几题得分率、课程目标几的达成度、作业平均分、问卷回收份数）。'
    '禁止写成"通过达成度分析验证改进效果"这类不含数值与口径的表述。\n\n'
    '硬性约束：\n'
    '- 共 3-6 条，每条 content 80-200 字，各条之间不得重复或语义雷同；\n'
    '- 必须贴合本课程实际：措施中出现的课程要素（章节、实验项目、考核方式、指标点、数据）'
    '只能取自报告正文，严禁编造报告未提及的内容；\n'
    '- 禁止照抄章节标题、问题描述原文或课程大纲语句；\n'
    '- 若报告未提供达成度数据，则以报告中实际描述的教学现象为依据，'
    '并在验证指标中改用可采集的替代口径（如课堂测验通过率、作业得分率、实验报告合格率）。\n\n'
    '示例（仅示范粒度与写法，具体内容须替换为本课程实际，不得照搬）：\n'
    '{"measures": [{"content": "针对课程目标3（零件装配图表达）达成度仅0.62、'
    '期末考试第六大题装配图得分率58%的短板，在第5-8周增设2次共4学时的装配图专项训练课，'
    '采用学生互评加教师逐张批注的方式，替换原有一次性大作业，'
    '由主讲教师负责，2025年春季学期第8周前完成。",'
    '"verify_indicator": "2025-2026学年第一学期该课程目标3达成度不低于0.72，'
    '且期末考试第六大题装配图得分率不低于70%；'
    '数据来源为教务系统成绩库与期末试卷逐题得分统计。"}]}\n\n'
    '只输出 JSON，不要输出任何解释、前后缀或 Markdown 代码块，格式为：'
    '{"measures": [{"content": "改进措施内容", "verify_indicator": "次年验证指标"}]}'
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
