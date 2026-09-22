# -*- coding: utf-8 -*-
"""规则式改进措施生成（纯函数，便于未来替换为 AI 实现）

规则：
1. 将报告文本切分为候选句（按换行、句号、分号切分，再按编号标记 1. 2. / 一、二、 细分）；
2. 以编号开头或含"问题/改进/措施/建议/加强/提升"等关键词识别候选措施句；
3. 过滤章节标题噪声：
   - 以"一、/二、/三、"等中文序号开头且不含改进动词（加强/提升/改进/强化/增加/优化/完善…）的短行；
   - 以"分析/措施/建议/总结"等结尾且少于 15 字的纯章节标题行；
4. 验证指标配对：优先取条目自身内含的"验证/指标/考核/达成度"分句（如"次年验证指标：…"），
   其次取同一条目内最近的验证句，再次取条目之后最近的验证句，避免跨条目错位；
5. 抽取失败（无任何候选）时兜底生成 1 条通用模板措施。
"""
import re

MEASURE_KEYWORDS = ('问题', '改进', '措施', '建议', '加强', '提升')
VERIFY_KEYWORDS = ('验证', '指标', '考核', '达成度')

# 改进动词：中文序号行含这些动词才视为真正的措施而非章节标题
ACTION_VERBS = ('加强', '提升', '改进', '强化', '增加', '优化', '完善',
                '增设', '增补', '引入', '开展', '建立', '健全', '落实',
                '推进', '充实', '提高', '深化', '拓展')

# 章节标题收尾词（如"存在问题分析""改进措施""下一步建议""工作总结"）
_HEADING_SUFFIX = ('分析', '措施', '建议', '总结', '情况', '说明', '概述', '报告')
_HEADING_MAX_LEN = 15

# 编号标记：1. 2、 3） (4) 一、 二.
_NUMBER_MARK = r'(?:\d+\s*[\.、．\)）]|[（(]\s*\d+\s*[)）]|[一二三四五六七八九十]+\s*[、．\.])'
_NUMBERED_PREFIX = re.compile(r'^\s*' + _NUMBER_MARK)
_CHINESE_NUMBER_PREFIX = re.compile(r'^\s*[一二三四五六七八九十]+\s*[、．\.]')
_SENTENCE_SPLIT = re.compile(r'[。；;！!?\n]+')
_INNER_NUMBER_RE = re.compile(_NUMBER_MARK)
# 条目内验证分句引导词（如"次年验证指标：…"）
_VERIFY_CLAUSE_SPLIT = re.compile(r'(?:次年|下一学年|下学期|后续)?验证(?:指标|方式|方法)?\s*[:：]')

FALLBACK_MEASURE = {
    'content': '针对课程教学中的薄弱环节制定专项改进方案，优化教学内容与方法，持续跟踪改进效果。',
    'verify_indicator': '下一学年通过课程目标达成度分析与学生评教结果验证改进效果。',
}

MAX_MEASURES = 6


def _split_segments(text):
    """切分为句子级片段，并进一步按编号标记拆分"""
    segments = []
    for part in _SENTENCE_SPLIT.split(text or ''):
        part = part.strip()
        if not part:
            continue
        # 在编号标记处切分（编号需位于句首或前面是空白/标点）
        cuts = [0]
        for m in _INNER_NUMBER_RE.finditer(part):
            if m.start() == 0:
                continue
            if part[m.start() - 1] in ' \t\u3000，,、;；':
                cuts.append(m.start())
        cuts.append(len(part))
        for a, b in zip(cuts, cuts[1:]):
            seg = part[a:b].strip()
            if seg:
                segments.append(seg)
    return segments


def _strip_number(seg):
    return _NUMBERED_PREFIX.sub('', seg).strip(' 　:：')


def _is_noise(raw_seg, content):
    """判断是否为章节标题、问题描述、引言句等噪声条目（raw_seg 为未去编号的原始片段）"""
    if not content:
        return True
    # 以"分析/措施/建议/总结"等结尾且较短的纯章节标题（如"存在问题分析""改进措施"）
    if len(content) < _HEADING_MAX_LEN and content.endswith(_HEADING_SUFFIX):
        return True
    # 中文序号开头的短行：不含改进动词则视为章节标题（如"一、存在问题分析"）
    if _CHINESE_NUMBER_PREFIX.match(raw_seg):
        return not any(v in content for v in ACTION_VERBS)
    # 同时出现"问题"与"措施/分析"的长句多为章节引言（如"现对存在问题进行分析并提出改进措施"）
    if '问题' in content and ('措施' in content or '分析' in content):
        return True
    # 以"验证指标/验证方式"等开头的句子本身就是验证句，不是措施（如"次年验证指标：…"）
    if _VERIFY_CLAUSE_SPLIT.match(content):
        return True
    # 非编号且不含改进动词的问题描述句（如"…不规范问题占比约28%"）
    if not _NUMBERED_PREFIX.match(raw_seg) and '问题' in content \
            and not any(v in content for v in ACTION_VERBS):
        return True
    # 编号开头但完全不含改进动词的短行，多为问题描述而非措施（如"1. 空间想象力训练不足"）
    if _NUMBERED_PREFIX.match(raw_seg) and len(content) < _HEADING_MAX_LEN \
            and not any(v in content for v in ACTION_VERBS):
        return True
    return False


def _extract_inline_verify(content):
    """若条目内含"验证指标：…"分句，拆分为（措施内容，验证指标）"""
    m = _VERIFY_CLAUSE_SPLIT.search(content)
    if m and m.start() > 0:
        head = content[:m.start()].strip(' 　,，、。；;')
        tail = _clean_verify(content[m.end():])
        if head and tail:
            return head, tail
    return content, ''


def _clean_verify(text):
    """去掉验证句首部的"次年验证指标："类引导词"""
    text = _VERIFY_CLAUSE_SPLIT.sub('', text or '').strip(' 　,，、。；;')
    return text


def generate_measures(text):
    """从报告纯文本生成改进措施列表（纯函数）。

    :param text: 报告全文
    :return: [{'content': 措施内容, 'verify_indicator': 次年验证指标}, ...]
    """
    segments = _split_segments(text)
    if not segments:
        return [dict(FALLBACK_MEASURE)]

    verify_idx, measure_idx = [], []
    for i, seg in enumerate(segments):
        if any(k in seg for k in VERIFY_KEYWORDS):
            verify_idx.append(i)
        if _NUMBERED_PREFIX.match(seg) or any(k in seg for k in MEASURE_KEYWORDS):
            measure_idx.append(i)

    results, seen = [], set()
    for i in measure_idx:
        content = _strip_number(segments[i])
        if _is_noise(segments[i], content) or content in seen:
            continue
        seen.add(content)

        # 1. 优先：条目自身内含的验证分句（避免跨条目错位）
        content, inline_verify = _extract_inline_verify(content)
        if inline_verify:
            verify = inline_verify
        else:
            # 2. 取同一条目之后最近的一句含"验证/指标/考核/达成度"的句子，
            #    没有则取之前最近的，避免跨条目错位配对；都没有则兜底模板。
            after = [j for j in verify_idx if j > i]
            before = [j for j in verify_idx if j < i]
            pool = after or before
            if pool:
                nearest = min(pool, key=lambda j: (abs(j - i), j))
                verify = _clean_verify(_strip_number(segments[nearest]))
            if not pool or not verify:
                verify = FALLBACK_MEASURE['verify_indicator']

        results.append({'content': content, 'verify_indicator': verify})
        if len(results) >= MAX_MEASURES:
            break

    return results or [dict(FALLBACK_MEASURE)]
