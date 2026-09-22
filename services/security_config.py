# -*- coding: utf-8 -*-
"""安全选项配置解析：settings 表(DB) > 默认值

设计要点（与 ai_config 一致的纯函数式解析）：
1. resolve(get_db_row) 为纯函数——调用方传入"按键查 settings 行"的取数函数，
   便于在无 Flask 请求上下文（测试、脚本、限速装饰器）时复用；
2. force_pwd_change：是否强制"首次登录修改初始密码"，默认开启；
3. login_max_attempts：连续登录失败临时锁定的最大尝试次数，默认 10，夹取 [3, 100]；
4. login_lock_minutes：锁定时长（分钟），默认 15，夹取 [1, 1440]；
5. random_password()：生成不含易混淆字符的随机初始密码。
"""
import secrets

# settings 表键 → 配置字段映射（解析结果字典的键名）
SETTINGS_KEYS = ('security_force_pwd_change', 'security_login_max_attempts',
                 'security_login_lock_minutes')

# 默认值
DEFAULT_FORCE_PWD_CHANGE = True
DEFAULT_LOGIN_MAX_ATTEMPTS = 10
DEFAULT_LOGIN_LOCK_MINUTES = 15

# 取值范围
ATTEMPTS_MIN, ATTEMPTS_MAX = 3, 100
LOCK_MINUTES_MIN, LOCK_MINUTES_MAX = 1, 1440

# 随机密码字符集（剔除易混淆的 0 O 1 l I）与长度
_PWD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
_PWD_LEN = 12


def random_password():
    """生成一个随机初始密码（字母+数字，去除易混淆字符）。"""
    return ''.join(secrets.choice(_PWD_ALPHABET) for _ in range(_PWD_LEN))


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


def _parse_int(raw, default, lo, hi):
    """容错解析整数并夹取到 [lo, hi]，非法值回落默认。"""
    try:
        val = int(str(raw).strip())
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, val))


def resolve(get_db_row):
    """按 DB 非空 > 默认值解析安全配置。

    :param get_db_row: 函数 (key) -> settings 行（含 'value' 列）或 None
    :return: {'force_pwd_change': bool, 'login_max_attempts': int,
              'login_lock_minutes': int}
    """
    db_force = _db_value(get_db_row, 'security_force_pwd_change')
    db_attempts = _db_value(get_db_row, 'security_login_max_attempts')
    db_lock = _db_value(get_db_row, 'security_login_lock_minutes')

    if db_force is not None:
        force = db_force == '1'
    else:
        force = DEFAULT_FORCE_PWD_CHANGE

    attempts = _parse_int(db_attempts or '', DEFAULT_LOGIN_MAX_ATTEMPTS,
                          ATTEMPTS_MIN, ATTEMPTS_MAX)
    lock = _parse_int(db_lock or '', DEFAULT_LOGIN_LOCK_MINUTES,
                      LOCK_MINUTES_MIN, LOCK_MINUTES_MAX)

    return {'force_pwd_change': force, 'login_max_attempts': attempts,
            'login_lock_minutes': lock}


def resolve_from_db(db):
    """请求上下文便捷封装：从 get_db() 连接解析配置。"""
    def get_db_row(key):
        return db.execute('SELECT value FROM settings WHERE key=?', (key,)).fetchone()
    return resolve(get_db_row)
