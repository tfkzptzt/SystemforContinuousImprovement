# -*- coding: utf-8 -*-
"""后端单元测试：状态机、措施生成、docx 抽取"""
import io
import os
import sys
import unittest
import zipfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.state_machine import (  # noqa: E402
    TRANSITIONS, transition, can_transition, IllegalTransitionError)
from services.measure_generator import generate_measures, FALLBACK_MEASURE  # noqa: E402
from services.docx_extract import extract_paragraphs, extract_text, DocxExtractError  # noqa: E402

ALL_STATUSES = ['draft', 'measures_generated', 'submitted', 'returned',
                'executing', 'concluded']
ALL_EVENTS = list(TRANSITIONS.keys())


class StateMachineTest(unittest.TestCase):
    def test_all_legal_transitions(self):
        expected = {
            ('draft', 'generate'): 'measures_generated',
            ('measures_generated', 'generate'): 'measures_generated',
            ('returned', 'generate'): 'measures_generated',
            ('measures_generated', 'submit_measures'): 'submitted',
            ('returned', 'submit_measures'): 'submitted',
            ('submitted', 'reject_measures'): 'returned',
            ('submitted', 'approve'): 'executing',
            ('executing', 'conclude'): 'concluded',
        }
        self.assertEqual(len(expected),
                         sum(len(m) for m in TRANSITIONS.values()))
        for event, mapping in TRANSITIONS.items():
            for src, dst in mapping.items():
                self.assertEqual(expected.get((src, event)), dst,
                                 f'迁移表与预期不符: {src} --{event}--> {dst}')
                self.assertTrue(can_transition(src, event))
                self.assertEqual(transition(src, event), dst)

    def test_full_happy_path(self):
        status = 'draft'
        for event in ['generate', 'submit_measures', 'approve', 'conclude']:
            status = transition(status, event)
        self.assertEqual(status, 'concluded')

    def test_return_resubmit_loop(self):
        status = transition('submitted', 'reject_measures')
        self.assertEqual(status, 'returned')
        status = transition(status, 'submit_measures')
        self.assertEqual(status, 'submitted')

    def test_removed_report_level_states_and_events(self):
        # 旧报告级状态/事件已移除：达成生命周期由 achievements.status 承担
        from services.state_machine import STATUS_LABELS
        for removed in ('approved', 'achievement_submitted', 'achievement_returned'):
            self.assertNotIn(removed, STATUS_LABELS)
        for event in ('start_executing', 'submit_achievement', 'reject_achievement'):
            self.assertNotIn(event, TRANSITIONS)
        self.assertEqual(STATUS_LABELS['executing'], '执行中')
        self.assertEqual(STATUS_LABELS['concluded'], '已定级')

    def test_illegal_transitions_raise(self):
        illegal = [
            ('draft', 'submit_measures'),
            ('draft', 'approve'),
            ('draft', 'conclude'),
            ('measures_generated', 'approve'),
            ('measures_generated', 'conclude'),
            ('submitted', 'conclude'),
            ('returned', 'approve'),
            ('returned', 'conclude'),
            ('executing', 'approve'),
            ('executing', 'reject_measures'),
            ('executing', 'submit_measures'),
            ('concluded', 'generate'),
            ('concluded', 'conclude'),
            ('concluded', 'approve'),
        ]
        for src, event in illegal:
            self.assertFalse(can_transition(src, event), f'{src} --{event}-- 不应合法')
            with self.assertRaises(IllegalTransitionError, msg=f'{src} --{event}-- 应抛异常'):
                transition(src, event)

    def test_unknown_event_and_status(self):
        with self.assertRaises(IllegalTransitionError):
            transition('draft', 'no_such_event')
        with self.assertRaises(IllegalTransitionError):
            transition('no_such_status', 'generate')

    def test_every_status_covered(self):
        covered = set()
        for mapping in TRANSITIONS.values():
            covered |= set(mapping.keys()) | set(mapping.values())
        for s in ALL_STATUSES:
            self.assertIn(s, covered)
        for e in ALL_EVENTS:
            self.assertIn(e, TRANSITIONS)


def make_docx(paragraphs):
    """内存构造最小 docx（zip + word/document.xml）"""
    buf = io.BytesIO()
    body = ''.join(
        f'<w:p><w:r><w:t xml:space="preserve">{p}</w:t></w:r></w:p>'
        for p in paragraphs)
    xml = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
           '<w:document xmlns:w='
           '"http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
           f'<w:body>{body}</w:body></w:document>')
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', '<?xml version="1.0"?><Types/>')
        z.writestr('word/document.xml', xml)
    buf.seek(0)
    return buf


class DocxExtractTest(unittest.TestCase):
    def test_extract_paragraphs(self):
        docx = make_docx(['第一段内容', '', '第二段：问题与改进措施', '  '])
        self.assertEqual(extract_paragraphs(docx), ['第一段内容', '第二段：问题与改进措施'])

    def test_extract_text_joins_by_newline(self):
        docx = make_docx(['甲', '乙'])
        self.assertEqual(extract_text(docx), '甲\n乙')

    def test_multiple_runs_in_one_paragraph(self):
        buf = io.BytesIO()
        xml = ('<?xml version="1.0"?>'
               '<w:document xmlns:w='
               '"http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
               '<w:body><w:p><w:r><w:t>前半</w:t></w:r>'
               '<w:r><w:t>后半</w:t></w:r></w:p></w:body></w:document>')
        with zipfile.ZipFile(buf, 'w') as z:
            z.writestr('word/document.xml', xml)
        buf.seek(0)
        self.assertEqual(extract_paragraphs(buf), ['前半后半'])

    def test_invalid_zip_raises(self):
        with self.assertRaises(DocxExtractError):
            extract_paragraphs(io.BytesIO(b'not a zip'))

    def test_missing_document_xml_raises(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w') as z:
            z.writestr('other.xml', '<a/>')
        buf.seek(0)
        with self.assertRaises(DocxExtractError):
            extract_paragraphs(buf)


class MeasureGeneratorTest(unittest.TestCase):
    def test_normal_numbered_measures(self):
        text = ('本课程本学期学生空间想象力存在不足。\n'
                '1. 加强模型教学，引入三维建模软件辅助讲解。\n'
                '2. 优化作业批改方式，增加个性化反馈。\n'
                '通过下一学年课程目标达成度指标验证效果。')
        measures = generate_measures(text)
        self.assertEqual(len(measures), 2)
        self.assertIn('加强模型教学', measures[0]['content'])
        self.assertIn('优化作业批改方式', measures[1]['content'])
        for m in measures:
            self.assertIn('达成度', m['verify_indicator'])
            self.assertNotEqual(m['verify_indicator'], m['content'])

    def test_chinese_numbered_and_keywords(self):
        text = '一、提升课堂互动频次；二、建议增加课外辅导答疑。验证方式为下学期考核指标。'
        measures = generate_measures(text)
        self.assertGreaterEqual(len(measures), 2)
        self.assertTrue(any('提升课堂互动频次' in m['content'] for m in measures))
        self.assertTrue(any('增加课外辅导答疑' in m['content'] for m in measures))
        for m in measures:
            self.assertTrue(m['verify_indicator'])

    def test_fallback_on_empty_text(self):
        measures = generate_measures('')
        self.assertEqual(len(measures), 1)
        self.assertEqual(measures[0], FALLBACK_MEASURE)

    def test_fallback_on_no_candidate(self):
        measures = generate_measures('今天天气很好。课程顺利结束。')
        self.assertEqual(len(measures), 1)
        self.assertEqual(measures[0]['content'], FALLBACK_MEASURE['content'])

    def test_nearest_verify_pairing(self):
        # 新规则：优先取同一条目之后最近的验证句，避免跨条目错位；
        # 措施1 应配对它后面的“验证指标B”（而非更早的验证指标A）。
        text = ('验证指标A：作业完成率。\n'
                '1. 加强习题训练。\n'
                '验证指标B：期末成绩达成度。\n'
                '一段无关描述文字，较长较长较长。\n'
                '2. 提升实验课时占比。')
        measures = generate_measures(text)
        self.assertEqual(len(measures), 2)
        self.assertIn('期末成绩达成度', measures[0]['verify_indicator'])
        self.assertIn('达成度', measures[1]['verify_indicator'])

    def test_heading_noise_filtered(self):
        # 章节标题、问题描述、引言句不应出现在措施中，验证指标逐条对应不串位。
        text = ('现对存在问题进行分析并提出改进措施。\n'
                '一、存在问题分析\n'
                '1. 空间想象力训练不足。学生得分率仅为65%。\n'
                '二、改进措施\n'
                '1. 增加三维建模软件辅助教学，强化空间想象力训练。'
                '次年验证指标：空间几何题得分率提升至80%以上。\n'
                '2. 改进实践环节考核方式，强化过程性考核。'
                '次年验证指标：实践环节达成度不低于0.75。')
        measures = generate_measures(text)
        self.assertEqual(len(measures), 2)
        for m in measures:
            self.assertNotIn('存在问题分析', m['content'])
            self.assertNotIn('改进措施', m['content'])
            self.assertNotIn('训练不足', m['content'])
        self.assertIn('得分率提升至80%', measures[0]['verify_indicator'])
        self.assertIn('达成度不低于0.75', measures[1]['verify_indicator'])

    def test_pure_function_no_side_effects(self):
        text = '存在问题，需要改进。'
        r1 = generate_measures(text)
        r2 = generate_measures(text)
        self.assertEqual(r1, r2)


if __name__ == '__main__':
    unittest.main()
