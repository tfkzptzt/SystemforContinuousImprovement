# -*- coding: utf-8 -*-
"""docx 纯文本抽取：标准库 zipfile + xml.etree（docx 即 zip，读取 word/document.xml 中的 <w:t> 文本）"""
import zipfile
from xml.etree import ElementTree as ET

W_NS = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'


class DocxExtractError(Exception):
    """docx 解析失败"""


def extract_paragraphs(docx_file):
    """抽取 docx 文本段落列表。

    :param docx_file: 文件路径或类文件对象（如 werkzeug FileStorage / BytesIO）
    :return: [str, ...] 非空段落列表
    """
    try:
        zf = zipfile.ZipFile(docx_file)
    except (zipfile.BadZipFile, OSError) as e:
        raise DocxExtractError(f'文件不是有效的 docx 格式：{e}') from e

    try:
        try:
            inner = zf.open('word/document.xml')
        except KeyError as e:
            raise DocxExtractError('docx 中缺少 word/document.xml') from e
        with inner:
            try:
                tree = ET.parse(inner)
            except ET.ParseError as e:
                raise DocxExtractError(f'document.xml 解析失败：{e}') from e
    finally:
        zf.close()

    paragraphs = []
    for p in tree.iter(W_NS + 'p'):
        texts = []
        for node in p.iter():
            if node.tag == W_NS + 't' and node.text:
                texts.append(node.text)
        line = ''.join(texts).strip()
        if line:
            paragraphs.append(line)
    return paragraphs


def extract_text(docx_file):
    """抽取 docx 全文（段落以换行连接）"""
    return '\n'.join(extract_paragraphs(docx_file))
