# -*- coding: utf-8 -*-
"""认证蓝图：session 登录/登出/当前用户，密码哈希，登录与角色装饰器"""
import json
import urllib.request
from functools import wraps

from flask import Blueprint, jsonify, request, session
from werkzeug.security import check_password_hash, generate_password_hash

import config
from db import get_db, log_action
from ratelimit import limiter
from services import dingtalk_config as dt_config
from services import security_config

bp = Blueprint('auth', __name__, url_prefix='/api/auth')
user_bp = Blueprint('user', __name__, url_prefix='/api/user')

# 允许"必须改密"用户访问的接口白名单（其余接口在改密前一律 428 拦截）
_FORCE_CHANGE_ALLOWLIST = {
    '/api/user/password', '/api/user/set-password',
    '/api/auth/me', '/api/auth/logout',
}


def _login_limit():
    """动态限速值：从 settings 表读取最大尝试次数与锁定时长，失败回落默认。

    注意：flask-limiter 4.x 的动态 limit 回调必须返回单个字符串（返回列表会被静默忽略）。
    """
    try:
        cfg = security_config.resolve_from_db(get_db())
        attempts = cfg['login_max_attempts']
        minutes = cfg['login_lock_minutes']
    except Exception:  # noqa: BLE001 - 无请求上下文/DB 异常时回落默认，绝不阻断登录
        attempts = security_config.DEFAULT_LOGIN_MAX_ATTEMPTS
        minutes = security_config.DEFAULT_LOGIN_LOCK_MINUTES
    return f'{attempts} per {minutes} minutes'


def _login_key():
    """限速计数键：IP + 用户名（小写），空用户名用 '_' 占位。"""
    data = request.get_json(silent=True) or {}
    username = str(data.get('username') or '').strip().lower() or '_'
    return f'login:{request.remote_addr}:{username}'


def ok(data=None):
    return jsonify({'ok': True, 'data': data})


def fail(msg, code=400):
    return jsonify({'ok': False, 'error': msg}), code


def get_current_user():
    """从 session 读取当前用户（不存在返回 None）"""
    uid = session.get('user_id')
    if not uid:
        return None
    return get_db().execute('SELECT * FROM users WHERE id=?', (uid,)).fetchone()


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        user = get_current_user()
        if user is None:
            return fail('未登录', 401)
        if user['is_disabled']:
            session.clear()
            return fail('账号已停用，请联系管理员', 403)
        # 首次登录强制改密：改密前仅放行白名单接口，其余一律 428 引导改密
        if _must_change(user) and request.path not in _FORCE_CHANGE_ALLOWLIST:
            return fail('首次登录请先修改初始密码', 428)
        request.current_user = user
        return view(*args, **kwargs)
    return wrapped


def _must_change(user):
    """当前用户是否处于"必须修改初始密码"状态（且该策略已在后台开启）。"""
    keys = user.keys()
    if 'must_change_password' not in keys or not user['must_change_password']:
        return False
    try:
        cfg = security_config.resolve_from_db(get_db())
    except Exception:  # noqa: BLE001
        return False
    return bool(cfg['force_pwd_change'])


# 角色名称 → users 表标志位列映射（多角色参数取并集）
ROLE_FLAG_MAP = {'teacher': 'is_teacher', 'leader': 'is_leader', 'admin': 'is_admin'}


def role_required(*roles):
    """限制角色，如 @role_required('teacher') / @role_required('leader', 'admin')"""
    flags = [ROLE_FLAG_MAP[r] for r in roles if r in ROLE_FLAG_MAP]

    def decorator(view):
        @wraps(view)
        @login_required
        def wrapped(*args, **kwargs):
            user = request.current_user
            if not flags or not any(user[f] for f in flags):
                return fail('无权限执行该操作', 403)
            return view(*args, **kwargs)
        return wrapped
    return decorator


def user_public(row):
    keys = row.keys()
    dt_bound = bool(row['dingtalk_userid']) if 'dingtalk_userid' in keys else False
    has_pwd = bool(row['password_hash']) if 'password_hash' in keys else True
    must_change = bool(row['must_change_password']) if 'must_change_password' in keys else False
    return {'id': row['id'], 'username': row['username'],
            'real_name': row['real_name'],
            'is_teacher': bool(row['is_teacher']),
            'is_leader': bool(row['is_leader']),
            'is_admin': bool(row['is_admin']),
            'dingtalk_bound': dt_bound,
            'has_password': has_pwd,
            'must_change_password': must_change}


@bp.post('/login')
@limiter.limit(_login_limit, key_func=_login_key, methods=['POST'])
def login():
    data = request.get_json(silent=True) or {}
    username = (data.get('username') or '').strip()
    password = data.get('password') or ''
    if not username or not password:
        return fail('请输入用户名和密码')
    db = get_db()
    user = db.execute('SELECT * FROM users WHERE username=?', (username,)).fetchone()
    if user is None:
        return fail('用户名或密码错误', 401)
    if not user['password_hash']:
        return fail('该账号已删除密码，请使用钉钉登录', 401)
    if not check_password_hash(user['password_hash'], password):
        return fail('用户名或密码错误', 401)
    if user['is_disabled']:
        log_action(db, user['id'], '停用账号尝试登录被拒绝', 'user', user['id'],
                   {'username': username})
        db.commit()
        return fail('账号已停用，请联系管理员', 403)
    session['user_id'] = user['id']
    log_action(db, user['id'], '登录', 'user', user['id'], {'username': username})
    db.commit()
    return ok(user_public(user))


@bp.post('/logout')
def logout():
    uid = session.get('user_id')
    if uid:
        db = get_db()
        log_action(db, uid, '登出', 'user', uid, {})
        db.commit()
    session.clear()
    return ok(None)


@bp.get('/me')
def me():
    user = get_current_user()
    if user is None:
        return jsonify({'ok': False, 'error': '未登录'})
    return ok(user_public(user))


@user_bp.put('/password')
@login_required
def change_password():
    """修改当前登录用户密码"""
    data = request.get_json(silent=True) or {}
    old_password = data.get('old_password') or ''
    new_password = data.get('new_password') or ''

    user = request.current_user
    if not check_password_hash(user['password_hash'], old_password):
        return fail('原密码错误', 400)
    if not new_password or len(new_password) < config.MIN_PASSWORD_LEN:
        return fail(f'新密码长度至少{config.MIN_PASSWORD_LEN}位', 400)

    db = get_db()
    db.execute('UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?',
               (generate_password_hash(new_password), user['id']))
    log_action(db, user['id'], '修改密码', 'user', user['id'], {'detail': '修改密码'})
    db.commit()
    return ok()


@user_bp.post('/remove-password')
@login_required
def remove_password():
    """删除当前用户密码（需已绑定钉钉），删除后仅支持钉钉登录"""
    user = request.current_user
    keys = user.keys()
    dt_id = user['dingtalk_userid'] if 'dingtalk_userid' in keys else ''
    if not dt_id:
        return fail('请先绑定钉钉账号后再删除密码', 400)
    if not user['password_hash']:
        return fail('密码已删除，无需重复操作')

    db = get_db()
    db.execute("UPDATE users SET password_hash='' WHERE id=?", (user['id'],))
    log_action(db, user['id'], '删除密码', 'user', user['id'],
               {'detail': '删除密码，仅保留钉钉登录'})
    db.commit()
    return ok()


@user_bp.post('/set-password')
@login_required
def set_password():
    """为已删除密码的用户重新设置密码（需已绑定钉钉）"""
    user = request.current_user
    keys = user.keys()
    dt_id = user['dingtalk_userid'] if 'dingtalk_userid' in keys else ''
    if not dt_id:
        return fail('请先绑定钉钉账号后再设置密码', 400)
    if user['password_hash']:
        return fail('当前账号已有密码，请使用修改密码功能', 400)

    data = request.get_json(silent=True) or {}
    new_password = data.get('new_password') or ''
    if not new_password or len(new_password) < config.MIN_PASSWORD_LEN:
        return fail(f'新密码长度至少{config.MIN_PASSWORD_LEN}位', 400)

    db = get_db()
    db.execute('UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?',
               (generate_password_hash(new_password), user['id']))
    log_action(db, user['id'], '设置密码', 'user', user['id'],
               {'detail': '删除密码后重新设置密码'})
    db.commit()
    return ok()


# ── 钉钉登录 ──────────────────────────────────────────────────

def _resolve_dt(db):
    """从 DB 解析钉钉配置"""
    return dt_config.resolve_from_db(db)


def _dingtalk_get_user_info(auth_code, app_key, app_secret):
    """用 authCode 换取钉钉 access_token 再拉取用户信息，返回 dict 或抛异常"""
    token_url = 'https://api.dingtalk.com/v1.0/oauth2/userAccessToken'
    token_body = json.dumps({
        'clientId': app_key,
        'clientSecret': app_secret,
        'code': auth_code,
        'grantType': 'authorization_code',
    }).encode()
    token_req = urllib.request.Request(token_url, data=token_body, method='POST')
    token_req.add_header('Content-Type', 'application/json')
    with urllib.request.urlopen(token_req, timeout=10) as resp:
        token_data = json.loads(resp.read())
    access_token = token_data.get('accessToken')
    if not access_token:
        raise ValueError(token_data.get('message', '获取钉钉 access_token 失败'))

    user_url = 'https://api.dingtalk.com/v1.0/contact/users/me'
    user_req = urllib.request.Request(user_url, method='GET')
    user_req.add_header('x-acs-dingtalk-access-token', access_token)
    with urllib.request.urlopen(user_req, timeout=10) as resp:
        user_data = json.loads(resp.read())
    if not user_data.get('unionId') and not user_data.get('openId'):
        raise ValueError(user_data.get('message', '获取钉钉用户信息失败'))
    return user_data


@bp.get('/dingtalk/config')
def dingtalk_config_endpoint():
    """前端用来判断是否显示钉钉登录按钮 + 获取授权跳转 URL"""
    db = get_db()
    dt = _resolve_dt(db)
    if not dt['enabled']:
        return ok({'enabled': False})
    auth_url = ('https://login.dingtalk.com/oauth2/auth'
                '?client_id={}&redirect_uri={}&response_type=code'
                '&scope=openid&prompt=consent').format(
                    dt['app_key'],
                    urllib.request.quote(dt['redirect_uri'], safe=''))
    return ok({'enabled': True, 'authUrl': auth_url})


@bp.post('/dingtalk/callback')
def dingtalk_callback():
    """钉钉授权回调：用 authCode 换取钉钉用户信息，已绑定则直接登录，未绑定则返回待绑定状态"""
    data = request.get_json(silent=True) or {}
    auth_code = (data.get('authCode') or '').strip()
    flow = (data.get('flow') or 'login').strip()
    if not auth_code:
        return fail('缺少授权码')

    db = get_db()
    dt = _resolve_dt(db)
    if not dt['enabled']:
        return fail('钉钉登录未配置')

    try:
        dt_user = _dingtalk_get_user_info(auth_code, dt['app_key'], dt['app_secret'])
    except Exception as e:
        return fail(f'钉钉授权失败：{e}', 400)

    union_id = dt_user.get('unionId', '')
    nick = dt_user.get('nick', '')

    if not union_id:
        return fail('钉钉未返回有效用户标识')

    db = get_db()

    # 绑定流程（已登录用户从"我的账户"发起）
    if flow == 'bind':
        cur = get_current_user()
        if not cur:
            return fail('未登录', 401)
        existing = db.execute(
            'SELECT id, real_name FROM users WHERE dingtalk_userid=? AND id!=?',
            (union_id, cur['id'])).fetchone()
        if existing:
            return fail(f'该钉钉账号已绑定到用户 {existing["real_name"]}')
        db.execute('UPDATE users SET dingtalk_userid=? WHERE id=?',
                   (union_id, cur['id']))
        log_action(db, cur['id'], '绑定钉钉', 'user', cur['id'],
                   {'nick': nick, 'unionId': union_id})
        db.commit()
        return ok({'bound': True})

    # 登录流程
    user = db.execute(
        'SELECT * FROM users WHERE dingtalk_userid=?', (union_id,)).fetchone()

    if user:
        if user['is_disabled']:
            return fail('账号已停用，请联系管理员', 403)
        session['user_id'] = user['id']
        log_action(db, user['id'], '钉钉登录', 'user', user['id'],
                   {'nick': nick})
        db.commit()
        return ok({'bound': True, 'user': user_public(user)})

    # 未绑定：存入 session，等前端引导用户输入用户名密码
    session['pending_dingtalk_unionid'] = union_id
    session['pending_dingtalk_nick'] = nick
    return ok({'bound': False, 'nick': nick})


@bp.post('/dingtalk/bind-login')
def dingtalk_bind_login():
    """钉钉未绑定用户输入用户名密码后，验证并绑定 + 登录"""
    data = request.get_json(silent=True) or {}
    username = (data.get('username') or '').strip()
    password = data.get('password') or ''
    union_id = session.get('pending_dingtalk_unionid')
    nick = session.get('pending_dingtalk_nick', '')

    if not union_id:
        return fail('钉钉授权已过期，请重新扫码')
    if not username or not password:
        return fail('请输入用户名和密码')

    db = get_db()
    user = db.execute('SELECT * FROM users WHERE username=?', (username,)).fetchone()
    if user is None or not check_password_hash(user['password_hash'], password):
        return fail('用户名或密码错误', 401)
    if user['is_disabled']:
        return fail('账号已停用，请联系管理员', 403)

    already = db.execute(
        'SELECT id, real_name FROM users WHERE dingtalk_userid=? AND id!=?',
        (union_id, user['id'])).fetchone()
    if already:
        return fail(f'该钉钉账号已绑定到用户 {already["real_name"]}')

    db.execute('UPDATE users SET dingtalk_userid=? WHERE id=?',
               (union_id, user['id']))
    session.pop('pending_dingtalk_unionid', None)
    session.pop('pending_dingtalk_nick', None)
    session['user_id'] = user['id']
    log_action(db, user['id'], '钉钉绑定并登录', 'user', user['id'],
               {'nick': nick, 'unionId': union_id})
    db.commit()
    return ok(user_public(user))


@user_bp.get('/dingtalk/status')
@login_required
def dingtalk_status():
    """返回当前用户是否已绑定钉钉"""
    user = request.current_user
    dt_id = user['dingtalk_userid'] if 'dingtalk_userid' in user.keys() else ''
    return ok({'bound': bool(dt_id), 'unionId': dt_id or ''})


@user_bp.post('/dingtalk/unbind')
@login_required
def dingtalk_unbind():
    """解绑当前用户的钉钉"""
    user = request.current_user
    keys = user.keys()
    if 'password_hash' in keys and not user['password_hash']:
        return fail('当前账号已删除密码，解绑钉钉后将无法登录，请先联系管理员重置密码', 400)
    db = get_db()
    db.execute("UPDATE users SET dingtalk_userid='' WHERE id=?", (user['id'],))
    log_action(db, user['id'], '解绑钉钉', 'user', user['id'], {})
    db.commit()
    return ok()
