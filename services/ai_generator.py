# -*- coding: utf-8 -*-
"""AI 大模型改进措施生成（OpenAI 兼容 /chat/completions）

设计要点：
1. 与规则引擎 measure_generator.generate_measures 保持一致的输出契约：
   返回 [{'content': str, 'verify_indicator': str}, ...]；本实现额外接受可选的
   课程上下文参数 context（规则引擎不需要），缺省时行为与规则引擎入参一致；
2. 配置参数化：generate_measures(text, settings)，settings 由 services.ai_config.resolve
   解析（DB > 环境变量 > 默认），含 enabled/api_key/base_url/model/timeout/prompt；
3. 仅用标准库 urllib.request 发起 HTTP 调用，零新增第三方依赖；
4. 网络/HTTP/解析任何环节失败均抛出 AiGeneratorError，由编排层降级到规则引擎；
5. 防御性解析：兼容 {"measures":[...]} 与裸数组两种形态、```json 代码块包裹、
   字段缺失（verify_indicator 用规则引擎兜底补齐）、空条目过滤、重复条目去重、
   超量截断；
6. 超长报告保留头部与尾部两段窗口——问题分析与改进建议章节通常在报告末尾，
   只留头部会让模型看不到最相关的内容；
7. 安全：日志与异常信息一律不出现 API Key。
"""
import json
import re
import urllib.parse
import urllib.request

from services import measure_generator
from services.ai_config import DEFAULT_PROMPT

# 与规则引擎保持一致的上限与兜底
MAX_MEASURES = measure_generator.MAX_MEASURES
_FALLBACK_VERIFY = measure_generator.FALLBACK_MEASURE['verify_indicator']

# 文本预处理：超长截断，保留头部 + 尾部
MAX_INPUT_CHARS = 8000
# 报告的"存在问题分析/改进建议"章节通常位于末尾，只保留头部会让模型看不到
# 最相关的内容，进而产出适用于任何课程的通用措施
_TAIL_CHARS = 2400
_TRUNCATED_SUFFIX = '…（中间内容已省略）…'

# 去重键：剥离全部空白，避免仅排版差异的重复条目
_WS_RE = re.compile(r'\s+')

# 单条措施 content / verify_indicator 输出长度上限（与输入截断形成对称防御）
MAX_ITEM_CHARS = 500

# 请求温度（越低越稳定，措施生成偏确定性）
_TEMPERATURE = 0.3

# 关闭思考模式的开关只对这些域名下发。enable_thinking 是 DashScope/百炼专有扩展，
# 其他 OpenAI 兼容服务遇到未知参数可能直接返回 400，因此按域名收窄而不是全局带上。
_DASHSCOPE_HOSTS = ('aliyuncs.com',)


class AiGeneratorError(Exception):
    """AI 生成失败（网络/HTTP/解析），编排层据此降级到规则引擎。

    异常信息中不得包含 API Key。
    """


def is_enabled(settings):
    """解析后的配置是否启用 AI 生成（enabled 且密钥非空）。"""
    return bool(settings.get('enabled')) and bool((settings.get('api_key') or '').strip())


def _truncate(text):
    """超过 MAX_INPUT_CHARS 字则保留头部与尾部，中间以标记省略。

    总长度仍为 MAX_INPUT_CHARS + len(_TRUNCATED_SUFFIX)。
    """
    text = text or ''
    if len(text) <= MAX_INPUT_CHARS:
        return text
    head_len = MAX_INPUT_CHARS - _TAIL_CHARS
    return text[:head_len] + _TRUNCATED_SUFFIX + text[-_TAIL_CHARS:]


def format_user_message(context, text):
    """拼装发送给模型的用户消息：课程信息头 + 报告正文。

    模型看不到课程名与学年学期时只能产出适用于任何课程的通用措施，
    补上上下文后措施才能落到本课程的具体环节与数据上。
    缺失的字段直接跳过，不输出空值。

    :param context: 可选的课程上下文字典
    :param text: 已截断的报告正文
    """
    ctx = context or {}
    info = []
    name = (ctx.get('course_name') or '').strip()
    if name:
        code = (ctx.get('course_code') or '').strip()
        info.append(f'课程名称：{name}' + (f'（{code}）' if code else ''))
    period = ' '.join((ctx.get(k) or '').strip()
                      for k in ('academic_year', 'term'))
    if period.strip():
        info.append(f'学年学期：{period.strip()}')
    teacher = (ctx.get('teacher_name') or '').strip()
    if teacher:
        info.append(f'任课教师：{teacher}')
    title = (ctx.get('title') or '').strip()
    if title:
        info.append(f'报告标题：{title}')

    parts = []
    if info:
        parts.append('【课程信息】\n' + '\n'.join(info))
    parts.append('【报告正文】\n' + (text or ''))
    return '\n\n'.join(parts)


def _dedup_key(content):
    return _WS_RE.sub('', content or '').lower()


def _is_dashscope(base_url):
    """base_url 是否指向阿里云 DashScope/百炼（含专属 MaaS 部署域名）。"""
    host = (urllib.parse.urlparse(base_url or '').hostname or '').lower()
    return any(host == h or host.endswith('.' + h) for h in _DASHSCOPE_HOSTS)


def _strip_code_fence(content):
    """剥离可能的 ```json ... ``` 或 ``` ... ``` 代码块包裹。"""
    s = (content or '').strip()
    if s.startswith('```'):
        # 去掉首行 ``` 或 ```json
        first_nl = s.find('\n')
        if first_nl != -1:
            s = s[first_nl + 1:]
        else:
            s = s[3:]
        # 去掉结尾 ```
        if s.rstrip().endswith('```'):
            s = s.rstrip()[:-3]
    return s.strip()


def _normalize_item(item):
    """校验单条措施：content 必须为非空字符串；verify_indicator 缺失用兜底补齐。

    content / verify_indicator 均截断至 MAX_ITEM_CHARS 字（输出长度防御）。
    返回规范化后的 dict，非法条目返回 None。
    """
    if not isinstance(item, dict):
        return None
    content = item.get('content')
    if not isinstance(content, str) or not content.strip():
        return None
    verify = item.get('verify_indicator')
    if not isinstance(verify, str) or not verify.strip():
        verify = _FALLBACK_VERIFY
    return {'content': content.strip()[:MAX_ITEM_CHARS],
            'verify_indicator': verify.strip()[:MAX_ITEM_CHARS]}


def parse_measures(response_json):
    """从 /chat/completions 响应体（已反序列化的 dict）解析出措施列表。

    防御性处理：
    - 取 choices[0].message.content；
    - 剥离 ```json 代码块包裹后 json.loads；
    - 接受 {"measures":[...]} 或直接 [...] 两种形态；
    - 逐项校验并补齐 verify_indicator，过滤空条目；
    - 按空白归一化后的内容去重（模型常产出仅排版不同的重复条目）；
    - 截断至 MAX_MEASURES 条；解析结果为 0 条视为失败。

    :raises AiGeneratorError: 响应结构异常或无有效措施
    """
    if not isinstance(response_json, dict):
        raise AiGeneratorError('AI 响应格式异常：顶层不是对象')
    try:
        content = response_json['choices'][0]['message']['content']
    except (KeyError, IndexError, TypeError):
        raise AiGeneratorError('AI 响应缺少 choices[0].message.content')
    if not isinstance(content, str):
        raise AiGeneratorError('AI 响应 message.content 非字符串')

    text = _strip_code_fence(content)
    if not text:
        raise AiGeneratorError('AI 响应内容为空')

    try:
        payload = json.loads(text)
    except (ValueError, TypeError):
        raise AiGeneratorError('AI 响应内容不是合法 JSON')

    if isinstance(payload, dict):
        raw_items = payload.get('measures')
    elif isinstance(payload, list):
        raw_items = payload
    else:
        raw_items = None
    if not isinstance(raw_items, list):
        raise AiGeneratorError('AI 响应缺少 measures 数组')

    results, seen = [], set()
    for item in raw_items:
        normalized = _normalize_item(item)
        if not normalized:
            continue
        key = _dedup_key(normalized['content'])
        if key in seen:
            continue
        seen.add(key)
        results.append(normalized)
        if len(results) >= MAX_MEASURES:
            break

    if not results:
        raise AiGeneratorError('AI 未返回任何有效改进措施')
    return results


def _call_chat_completions(user_text, settings):
    """调用 OpenAI 兼容 /chat/completions，返回响应文本（str）。

    :param settings: ai_config.resolve 解析后的配置字典
    :raises AiGeneratorError: 任何网络/HTTP 异常（信息中不含 API Key）
    """
    base_url = settings.get('base_url') or ''
    url = base_url.rstrip('/') + '/chat/completions'
    body = {
        'model': settings.get('model'),
        'temperature': _TEMPERATURE,
        'response_format': {'type': 'json_object'},
        'messages': [
            {'role': 'system',
             'content': (settings.get('prompt') or '').strip() or DEFAULT_PROMPT},
            {'role': 'user', 'content': user_text},
        ],
    }
    # 思考模式下模型会先输出大段推理再给答案，非流式调用要把这些 token 全等完，
    # 耗时成倍增长；措施生成不需要推理链，明确关掉。
    if _is_dashscope(base_url):
        body['enable_thinking'] = False
    data = json.dumps(body, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(url, data=data, method='POST')
    req.add_header('Authorization', 'Bearer ' + (settings.get('api_key') or ''))
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=settings.get('timeout')) as resp:
            return resp.read().decode('utf-8')
    except Exception as e:  # noqa: BLE001 - 统一转换为不泄露密钥的错误
        # 仅保留异常类型，避免 HTTPError 等对象在字符串化时携带敏感上下文
        raise AiGeneratorError(f'调用 AI 服务失败：{type(e).__name__}')


def generate_measures(text, settings, context=None):
    """从报告全文生成改进措施（AI 实现，契约同规则引擎）。

    :param text: 报告全文
    :param settings: ai_config.resolve 解析后的配置字典
    :param context: 可选的课程上下文（course_name/course_code/academic_year/
                    term/teacher_name/title），传入后模型才能产出贴合本课程的措施
    :return: [{'content': 措施内容, 'verify_indicator': 次年验证指标}, ...]
    :raises AiGeneratorError: 调用或解析失败，编排层应降级到规则引擎
    """
    if not is_enabled(settings):
        raise AiGeneratorError('AI 未启用（缺少 API Key）')
    # 先截断正文再拼上下文头，避免课程信息挤占正文预算
    user_text = format_user_message(context, _truncate(text))
    raw = _call_chat_completions(user_text, settings)
    try:
        response_json = json.loads(raw)
    except (ValueError, TypeError):
        raise AiGeneratorError('AI 响应体不是合法 JSON')
    return parse_measures(response_json)
