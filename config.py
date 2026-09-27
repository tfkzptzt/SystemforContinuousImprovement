# -*- coding: utf-8 -*-
"""全局配置"""
import os
import secrets

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# 数据库
DATABASE = os.path.join(BASE_DIR, 'data.db')
SCHEMA_FILE = os.path.join(BASE_DIR, 'schema.sql')

# 上传
UPLOAD_DIR = os.path.join(BASE_DIR, 'uploads')
MAX_UPLOAD_MB = 10
MAX_CONTENT_LENGTH = MAX_UPLOAD_MB * 1024 * 1024
ALLOWED_REPORT_EXT = '.docx'

# 导入模板
TEMPLATE_DIR = os.path.join(BASE_DIR, 'templates_import')
IMPORT_TEMPLATE_FILENAME = '导入模板.xlsx'
IMPORT_COLUMNS = ['教师工号', '课程代码', '学年', '学期', '报告标题', '措施内容', '验证指标', '结论']

# 业务常量
# 审批通过时已改为负责人逐条手动设置截止时间，此默认值仅供历史报告导入（importer）使用
DEFAULT_MEASURE_DEADLINE = '2026-01-31'
CONCLUSION_OPTIONS = ['已达成目标', '基本达成目标', '部分达成目标', '未达成目标']

# 密码策略：最短长度（管理员创建/重置、用户改密/设密统一使用）
MIN_PASSWORD_LEN = 8

# 登录限速：默认启用，测试可置 config.RATELIMIT_ENABLED=False 关闭
RATELIMIT_ENABLED = True

# Flask：优先取环境变量，缺省随机生成（重启后会话失效，演示系统可接受）
SECRET_KEY = os.environ.get('SECRET_KEY') or secrets.token_hex(32)

# AI 大模型生成改进措施（可选）：均取环境变量，未配置 AI_API_KEY 时自动使用内置规则引擎
# 密钥为空即视为未启用 AI，编排层会直接走规则引擎
AI_API_KEY = os.environ.get('AI_API_KEY', '')
# OpenAI 兼容服务的 base url（不带 /chat/completions），默认阿里云百炼兼容模式
AI_BASE_URL = os.environ.get('AI_BASE_URL', 'https://dashscope.aliyuncs.com/compatible-mode/v1')
# 模型名，默认通义千问 qwen-plus
AI_MODEL = os.environ.get('AI_MODEL', 'qwen-plus')
# 单次请求超时（秒）：容错解析，非法值（空串/非数字/≤0）回落默认 60.0
# 默认提示词要求 3-6 条、每条 80-200 字并附量化验证指标，非流式输出约 1500+ token，
# 20s 必然超时并被降级到规则引擎，故下限取 60s。部署时须保证链路递增：
# AI_TIMEOUT < gunicorn --timeout < Nginx proxy_read_timeout
def _parse_ai_timeout(raw, default=60.0):
    try:
        val = float(str(raw).strip())
    except (TypeError, ValueError):
        return default
    return val if val > 0 else default


AI_TIMEOUT = _parse_ai_timeout(os.environ.get('AI_TIMEOUT', ''))

# 钉钉登录（可选）：三个环境变量均配置后启用，任一缺失则钉钉登录入口不显示
DINGTALK_APP_KEY = os.environ.get('DINGTALK_APP_KEY', '')
DINGTALK_APP_SECRET = os.environ.get('DINGTALK_APP_SECRET', '')
DINGTALK_REDIRECT_URI = os.environ.get('DINGTALK_REDIRECT_URI', '')
