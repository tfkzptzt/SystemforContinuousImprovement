# -*- coding: utf-8 -*-
"""钉钉登录配置解析：settings 表(DB) > 环境变量

settings 表键：dingtalk_app_key / dingtalk_app_secret / dingtalk_redirect_uri
三个字段均在 DB 或环境变量中配置后启用钉钉登录。
"""
import config

SETTINGS_KEYS = ('dingtalk_app_key', 'dingtalk_app_secret', 'dingtalk_redirect_uri')


def _db_value(get_db_row, key):
    row = get_db_row(key)
    if row is None:
        return None
    try:
        value = row['value']
    except (KeyError, IndexError, TypeError):
        return None
    value = (value or '').strip()
    return value or None


def resolve(get_db_row):
    """按 DB 非空 > 环境变量解析钉钉配置。

    :return: {'app_key': str, 'app_secret': str, 'redirect_uri': str,
              'enabled': bool, 'source': {键: 'db'|'env'|''}}
    """
    db_key = _db_value(get_db_row, 'dingtalk_app_key')
    db_secret = _db_value(get_db_row, 'dingtalk_app_secret')
    db_uri = _db_value(get_db_row, 'dingtalk_redirect_uri')

    env_key = (config.DINGTALK_APP_KEY or '').strip()
    env_secret = (config.DINGTALK_APP_SECRET or '').strip()
    env_uri = (config.DINGTALK_REDIRECT_URI or '').strip()

    app_key = db_key or env_key
    app_secret = db_secret or env_secret
    redirect_uri = db_uri or env_uri

    enabled = bool(app_key and app_secret and redirect_uri)

    source = {
        'app_key': 'db' if db_key else ('env' if env_key else ''),
        'app_secret': 'db' if db_secret else ('env' if env_secret else ''),
        'redirect_uri': 'db' if db_uri else ('env' if env_uri else ''),
    }
    return {'app_key': app_key, 'app_secret': app_secret,
            'redirect_uri': redirect_uri, 'enabled': enabled,
            'source': source}


def resolve_from_db(db):
    def get_db_row(key):
        return db.execute('SELECT value FROM settings WHERE key=?', (key,)).fetchone()
    return resolve(get_db_row)
