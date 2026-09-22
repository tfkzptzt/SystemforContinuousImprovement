# -*- coding: utf-8 -*-
"""管理蓝图：字典、批量导入、导入模板下载、日志查询"""
import json
import os
from urllib.parse import quote

from flask import Blueprint, request, send_from_directory

import config
from auth import ok, fail, login_required, role_required
from db import get_db, log_action
from services import importer

bp = Blueprint('admin', __name__, url_prefix='/api')


@bp.get('/dictionaries')
@login_required
def dictionaries():
    db = get_db()
    courses = []
    for r in db.execute(
        'SELECT c.id, c.name, c.code, c.academic_year, c.term, c.start_date, c.end_date, '
        'c.leader_id, u.real_name AS leader_name '
        'FROM courses c LEFT JOIN users u ON c.leader_id=u.id '
        'ORDER BY c.academic_year, c.term, c.code').fetchall():
        item = dict(r)
        for k in ('start_date', 'end_date'):
            if item[k] and len(item[k]) > 10:
                item[k] = item[k][:10]
        courses.append(item)
    teachers = [{'id': r['id'], 'real_name': r['real_name'], 'username': r['username']}
                for r in db.execute(
                    'SELECT id, real_name, username FROM users '
                    'WHERE is_teacher=1 AND is_disabled=0 ORDER BY id').fetchall()]
    users = [{'id': r['id'], 'real_name': r['real_name'], 'username': r['username'],
              'is_teacher': bool(r['is_teacher']), 'is_leader': bool(r['is_leader']),
              'is_admin': bool(r['is_admin']), 'is_disabled': bool(r['is_disabled'])}
             for r in db.execute(
                 'SELECT id, real_name, username, is_teacher, is_leader, is_admin, '
                 'is_disabled FROM users ORDER BY id').fetchall()]
    academic_years = [r['name'] for r in db.execute(
        'SELECT name FROM academic_years ORDER BY name').fetchall()]
    # 不再返回 default_deadline：审批截止时间已改为负责人逐条手动设置，
    # 前端已无消费方（教师端改期用 PATCH /api/measures/<id>/deadline，不依赖默认值）。
    return ok({'courses': courses, 'teachers': teachers, 'users': users,
               'academic_years': academic_years,
               'conclusions': config.CONCLUSION_OPTIONS})


@bp.post('/import')
@role_required('leader')
def import_data():
    user = request.current_user
    file = request.files.get('file')
    if file is None or not file.filename:
        return fail('请上传导入文件')
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ('.xlsx', '.xlsm', '.csv'):
        return fail('仅支持 .xlsx / .csv 文件')

    db = get_db()
    try:
        result = importer.import_rows(db, file.stream, file.filename)
    except importer.ImportError_ as e:
        return fail(str(e))

    log_action(db, user['id'], '批量导入', 'import', 0,
               {'filename': file.filename, 'success_rows': result['success_rows'],
                'failed_rows': result['failed_rows']})
    db.commit()
    return ok(result)


@bp.get('/import/template')
@login_required
def import_template():
    importer.ensure_import_template()
    resp = send_from_directory(config.TEMPLATE_DIR, config.IMPORT_TEMPLATE_FILENAME)
    # 同时提供 ASCII filename 与 RFC 5987 filename*（中文 URL 编码），
    # 避免非 ASCII 文件名导致 Content-Disposition 中 filename= 为空。
    ascii_name = 'import_template.xlsx'
    utf8_name = quote(config.IMPORT_TEMPLATE_FILENAME, safe='')
    resp.headers['Content-Disposition'] = (
        f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{utf8_name}")
    return resp


@bp.get('/logs')
@role_required('leader')
def logs():
    args = request.args
    object_type = args.get('object_type', '').strip()
    object_id = args.get('object_id', '').strip()
    user_id = args.get('user_id', '').strip()
    try:
        page = max(1, int(args.get('page', 1)))
        page_size = min(100, max(1, int(args.get('page_size', 20))))
    except ValueError:
        return fail('分页参数错误')

    where, params = [], []
    if object_type:
        where.append('al.object_type=?')
        params.append(object_type)
    if object_id:
        where.append('al.object_id=?')
        params.append(object_id)
    if user_id:
        where.append('al.user_id=?')
        params.append(user_id)
    where_sql = ('WHERE ' + ' AND '.join(where)) if where else ''

    db = get_db()
    total = db.execute(
        f'SELECT COUNT(*) AS c FROM action_log al {where_sql}', params).fetchone()['c']
    rows = db.execute(
        'SELECT al.*, COALESCE(u.real_name, \'系统\') AS user_name '
        f'FROM action_log al LEFT JOIN users u ON al.user_id=u.id {where_sql} '
        'ORDER BY al.created_at DESC, al.id DESC LIMIT ? OFFSET ?',
        params + [page_size, (page - 1) * page_size]).fetchall()

    items = []
    for r in rows:
        item = dict(r)
        try:
            item['detail'] = json.loads(item['detail'])
        except (TypeError, ValueError):
            item['detail'] = {}
        items.append(item)
    return ok({'items': items, 'total': total, 'page': page, 'page_size': page_size})
