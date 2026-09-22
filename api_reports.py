# -*- coding: utf-8 -*-
"""教师端蓝图：报告上传/列表/详情/删除、措施生成与编辑、提交、改截止时间、
我的任务（分配给我的措施）、按措施提交达成报告"""
import io
import json
import os
import uuid
import zipfile
from datetime import date, datetime
from xml.sax.saxutils import escape

from flask import (Blueprint, request, current_app, send_file,
                   send_from_directory)

import config
from auth import login_required, ok, fail, role_required
from db import get_db, log_action, now, get_report, get_measures
from services import docx_extract, measure_generator, ai_generator, ai_config
from services.state_machine import transition, IllegalTransitionError, STATUS_LABELS

bp = Blueprint('reports', __name__, url_prefix='/api')

GENERATE_ALLOWED = ('draft', 'measures_generated', 'returned')
DELETE_ALLOWED = ('draft', 'measures_generated', 'returned')


def _report_brief(r):
    return {
        'id': r['id'], 'title': r['title'], 'status': r['status'],
        'status_label': STATUS_LABELS.get(r['status'], r['status']),
        'source': r['source'], 'created_at': r['created_at'],
        'course_id': r['course_id'], 'course_name': r['course_name'],
        'course_code': r['course_code'], 'academic_year': r['academic_year'],
        'term': r['term'], 'teacher_id': r['teacher_id'],
        'teacher_name': r['teacher_name'],
    }


@bp.post('/reports')
@role_required('teacher')
def create_report():
    user = request.current_user
    course_id = request.form.get('course_id', '').strip()
    file = request.files.get('file')
    if not course_id:
        return fail('请选择课程')
    if file is None or not file.filename:
        return fail('请上传报告文件')
    if not file.filename.lower().endswith(config.ALLOWED_REPORT_EXT):
        return fail('仅支持 .docx 格式的报告文件')

    raw = file.read()
    if len(raw) > config.MAX_CONTENT_LENGTH:
        return fail(f'文件大小超过 {config.MAX_UPLOAD_MB}MB 限制')
    if not raw:
        return fail('上传文件为空')

    db = get_db()
    course = db.execute('SELECT * FROM courses WHERE id=?', (course_id,)).fetchone()
    if course is None:
        return fail('课程不存在')

    # 抽取文本（失败则提示文件格式问题）
    try:
        content_text = docx_extract.extract_text(io.BytesIO(raw))
    except docx_extract.DocxExtractError as e:
        return fail(str(e))

    os.makedirs(config.UPLOAD_DIR, exist_ok=True)
    stored_name = uuid.uuid4().hex + config.ALLOWED_REPORT_EXT
    file_path = os.path.join(config.UPLOAD_DIR, stored_name)
    with open(file_path, 'wb') as f:
        f.write(raw)

    title = os.path.splitext(file.filename)[0]
    ts = now()
    cur = db.execute(
        'INSERT INTO reports (teacher_id, course_id, leader_id, title, file_path, '
        'content_text, status, source, created_at, updated_at) '
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        (user['id'], course['id'], course['leader_id'], title, file_path,
         content_text, 'draft', 'upload', ts, ts))
    report_id = cur.lastrowid
    log_action(db, user['id'], '上传报告', 'report', report_id,
               {'report_id': report_id, 'filename': file.filename,
                'course': f"{course['name']}({course['code']})"})
    db.commit()
    return ok(_report_brief(get_report(db, report_id)))


@bp.get('/reports')
@login_required
def list_reports():
    user = request.current_user
    db = get_db()
    sql = ('SELECT r.*, u.real_name AS teacher_name, c.name AS course_name, '
           'c.code AS course_code, c.academic_year, c.term '
           'FROM reports r JOIN users u ON r.teacher_id=u.id '
           'JOIN courses c ON r.course_id=c.id ')
    args = ()
    # 仅纯教师（非负责人/管理员）只看自己的报告；负责人、管理员、双角色用户可看全部
    if user['is_teacher'] and not (user['is_leader'] or user['is_admin']):
        sql += 'WHERE r.teacher_id=? '
        args = (user['id'],)
    sql += 'ORDER BY r.created_at DESC, r.id DESC'
    rows = db.execute(sql, args).fetchall()
    return ok([_report_brief(r) for r in rows])


@bp.get('/reports/<int:rid>')
@login_required
def report_detail(rid):
    user = request.current_user
    db = get_db()
    report = get_report(db, rid)
    if report is None:
        return fail('报告不存在', 404)
    if user['is_teacher'] and not (user['is_leader'] or user['is_admin']) \
            and report['teacher_id'] != user['id']:
        return fail('无权限查看该报告', 403)

    measures = [dict(m) for m in get_measures(db, rid)]

    # 达成报告按措施一对一：每条措施嵌套 achievement（含提交人姓名与最新打回原因）
    ach_rows = db.execute(
        'SELECT a.*, u.real_name AS submitter_name FROM achievements a '
        'JOIN users u ON a.submitter_id=u.id WHERE a.report_id=?', (rid,)).fetchall()
    ach_by_measure = {a['measure_id']: dict(a) for a in ach_rows}
    latest_reject = {r['target_id']: r['reason'] for r in db.execute(
        "SELECT target_id, reason FROM rejections WHERE target_type='achievement' "
        "AND target_id IN (SELECT id FROM achievements WHERE report_id=?) "
        "AND id IN (SELECT MAX(id) FROM rejections WHERE target_type='achievement' "
        'GROUP BY target_id)', (rid,)).fetchall()}
    for m in measures:
        ach = ach_by_measure.get(m['id'])
        if ach is None:
            m['achievement'] = None
        else:
            m['achievement'] = {
                'id': ach['id'], 'status': ach['status'], 'content': ach['content'],
                'submitter_name': ach['submitter_name'],
                'submitted_at': ach['submitted_at'],
                'returned_reason': latest_reject.get(ach['id'])
                if ach['status'] == 'returned' else None,
            }

    # 退回记录：措施退回（target_type='measures'，target_id=报告ID，见 api_approvals.reject_measures）
    # + 达成退回（target_type='achievement'，target_id ∈ 本报告 achievements），
    # 达成退回附对应 measure_seq 便于前端定位到具体措施。
    rejections = [dict(r) for r in db.execute(
        "SELECT rj.*, u.real_name AS rejecter_name, NULL AS measure_seq "
        "FROM rejections rj JOIN users u ON rj.rejecter_id=u.id "
        "WHERE rj.target_type='measures' AND rj.target_id=? "
        'UNION ALL '
        "SELECT rj.*, u.real_name AS rejecter_name, m.seq AS measure_seq "
        "FROM rejections rj JOIN users u ON rj.rejecter_id=u.id "
        "JOIN achievements a ON a.id=rj.target_id "
        "JOIN measures m ON m.id=a.measure_id "
        "WHERE rj.target_type='achievement' AND a.report_id=? "
        'ORDER BY created_at', (rid, rid)).fetchall()]

    # 时间线：优先用 object_type/object_id 精确匹配；detail 兼容匹配采用带分隔符的完整模式（"," 或 "}"）
    # 避免 report_id=1 误命中 12/100 等前缀。
    timeline = [dict(t) for t in db.execute(
        "SELECT al.action, al.object_type, al.object_id, al.detail, al.created_at, "
        "COALESCE(u.real_name, '系统') AS operator_name "
        "FROM action_log al LEFT JOIN users u ON al.user_id=u.id "
        "WHERE (al.object_type='report' AND al.object_id=?) "
        "OR al.detail LIKE ? OR al.detail LIKE ? ORDER BY al.created_at, al.id",
        (rid, f'%"report_id": {rid},%', f'%"report_id": {rid}}}%')).fetchall()]
    for t in timeline:
        try:
            t['detail'] = json.loads(t['detail'])
        except (TypeError, ValueError):
            t['detail'] = {}

    data = _report_brief(report)
    data.update({
        'file_path': os.path.basename(report['file_path'] or ''),
        'content_text': report['content_text'],
        'updated_at': report['updated_at'],
        'conclusion': report['conclusion'] or '',
        'concluded_at': report['concluded_at'],
        'measures': measures,
        'rejections': rejections,
        'timeline': timeline,
    })
    return ok(data)


@bp.delete('/reports/<int:rid>')
@role_required('teacher')
def delete_report(rid):
    """删除报告（仅创建教师本人，状态 ∈ draft/measures_generated/returned）。

    单事务级联删除 achievements → rejections(措施退回) → measures → 报告行，
    报告行 DELETE 带 status IN 条件 + rowcount 防并发；磁盘上传文件删除失败仅记录；
    action_log 保留（审计不回删）。
    """
    user = request.current_user
    db = get_db()
    report = db.execute('SELECT * FROM reports WHERE id=?', (rid,)).fetchone()
    if report is None:
        return fail('报告不存在', 404)
    if report['teacher_id'] != user['id']:
        return fail('无权限删除该报告', 403)
    if report['status'] not in DELETE_ALLOWED:
        return fail('当前状态不允许删除')

    ph = ','.join('?' * len(DELETE_ALLOWED))
    # 防御性补删：本报告各措施的达成打回记录（target_type='achievement'），避免遗留孤儿
    db.execute(
        "DELETE FROM rejections WHERE target_type='achievement' AND target_id IN "
        '(SELECT id FROM achievements WHERE report_id=?)', (rid,))
    db.execute('DELETE FROM achievements WHERE report_id=?', (rid,))
    db.execute(
        "DELETE FROM rejections WHERE target_type='measures' AND target_id=?", (rid,))
    db.execute('DELETE FROM measures WHERE report_id=?', (rid,))
    cur = db.execute(f'DELETE FROM reports WHERE id=? AND status IN ({ph})',
                     (rid,) + DELETE_ALLOWED)
    if cur.rowcount == 0:
        # 并发下状态已被迁移（如已提交审批），事务内未提交任何删除，直接回滚
        db.rollback()
        return fail('当前状态不允许删除')
    log_action(db, user['id'], '删除报告', 'report', rid,
               {'report_id': rid, 'title': report['title'],
                'status': report['status']})
    db.commit()

    # 磁盘上传文件删除：失败仅记录，不阻断
    path = report['file_path'] or ''
    if path and os.path.exists(path):
        try:
            os.remove(path)
        except OSError as e:
            current_app.logger.warning('删除上传文件失败 %s: %s', path, e)
    return ok({'id': rid})


@bp.post('/reports/<int:rid>/generate')
@role_required('teacher')
def generate_measures(rid):
    user = request.current_user
    db = get_db()
    report = get_report(db, rid)
    if report is None:
        return fail('报告不存在', 404)
    if report['teacher_id'] != user['id']:
        return fail('无权限操作该报告', 403)
    if report['status'] not in GENERATE_ALLOWED:
        return fail(f"当前状态「{STATUS_LABELS.get(report['status'])}」不允许生成措施")

    # AI 优先（配置按 settings 表 > 环境变量 > 默认解析）：启用且调用成功用 AI 结果
    # （source='ai'）；失败则降级到规则引擎（source='rule'）
    settings = ai_config.resolve_from_db(db)
    if ai_generator.is_enabled(settings):
        try:
            items = ai_generator.generate_measures(report['content_text'] or '', settings)
            source = 'ai'
        except Exception:  # noqa: BLE001 - AiGeneratorError 及其他异常均降级，不影响用户
            # 降级前记录可观测日志（AiGeneratorError 消息仅含异常类型名，不含密钥）
            current_app.logger.exception('AI 生成失败，降级到规则引擎 report_id=%s', rid)
            items = measure_generator.generate_measures(report['content_text'] or '')
            source = 'rule'
    else:
        items = measure_generator.generate_measures(report['content_text'] or '')
        source = 'rule'
    new_status = transition(report['status'], 'generate')
    cur = db.execute('UPDATE reports SET status=?, updated_at=? WHERE id=? AND status=?',
                     (new_status, now(), rid, report['status']))
    if cur.rowcount == 0:
        return fail('报告状态已变更，请刷新后重试')
    db.execute('DELETE FROM measures WHERE report_id=?', (rid,))
    for seq, item in enumerate(items, start=1):
        db.execute(
            'INSERT INTO measures (report_id, seq, content, verify_indicator, status) '
            'VALUES (?, ?, ?, ?, ?)',
            (rid, seq, item['content'], item['verify_indicator'], 'draft'))
    detail = {'report_id': rid, 'count': len(items)}
    # generate_source 仅 AI 成功时记录（对未启用 AI 的部署避免恒定 'rule' 噪声）
    if source == 'ai':
        detail['generate_source'] = source
    log_action(db, user['id'], '生成改进措施', 'report', rid, detail)
    db.commit()
    return ok([{'seq': i + 1, 'content': m['content'], 'verify_indicator': m['verify_indicator']}
               for i, m in enumerate(items)])


@bp.put('/reports/<int:rid>/measures')
@role_required('teacher')
def save_measures(rid):
    user = request.current_user
    db = get_db()
    report = get_report(db, rid)
    if report is None:
        return fail('报告不存在', 404)
    if report['teacher_id'] != user['id']:
        return fail('无权限操作该报告', 403)
    if report['status'] not in ('draft', 'measures_generated', 'returned'):
        return fail(f"当前状态「{STATUS_LABELS.get(report['status'])}」不允许编辑措施")

    body = request.get_json(silent=True) or {}
    items = body.get('measures') or []
    if not isinstance(items, list) or not items:
        return fail('措施列表不能为空')
    for item in items:
        if not isinstance(item, dict) or not str(item.get('content') or '').strip():
            return fail('每条措施的内容不能为空')

    # 手动填写：草稿首次保存即视为已生成措施（不经过 AI/规则引擎）
    new_status = 'measures_generated' if report['status'] == 'draft' else report['status']
    cur = db.execute('UPDATE reports SET status=?, updated_at=? WHERE id=? AND status=?',
                     (new_status, now(), rid, report['status']))
    if cur.rowcount == 0:
        return fail('报告状态已变更，请刷新后重试')
    db.execute('DELETE FROM measures WHERE report_id=?', (rid,))
    for seq, item in enumerate(items, start=1):
        db.execute(
            'INSERT INTO measures (report_id, seq, content, verify_indicator, status) '
            'VALUES (?, ?, ?, ?, ?)',
            (rid, seq, str(item['content']).strip(),
             str(item.get('verify_indicator') or '').strip(), 'draft'))
    log_action(db, user['id'], '保存措施', 'report', rid,
               {'report_id': rid, 'count': len(items)})
    db.commit()
    return ok([{'seq': m['seq'], 'id': m['id'], 'content': m['content'],
                'verify_indicator': m['verify_indicator']} for m in get_measures(db, rid)])


@bp.post('/reports/<int:rid>/submit')
@role_required('teacher')
def submit_report(rid):
    user = request.current_user
    db = get_db()
    report = get_report(db, rid)
    if report is None:
        return fail('报告不存在', 404)
    if report['teacher_id'] != user['id']:
        return fail('无权限操作该报告', 403)

    measures = get_measures(db, rid)
    if not measures:
        return fail('请先生成改进措施')
    if any(not (m['content'] or '').strip() for m in measures):
        return fail('存在内容为空的措施，请补充后再提交')

    try:
        new_status = transition(report['status'], 'submit_measures')
    except IllegalTransitionError as e:
        return fail(str(e))
    cur = db.execute('UPDATE reports SET status=?, updated_at=? WHERE id=? AND status=?',
                     (new_status, now(), rid, report['status']))
    if cur.rowcount == 0:
        return fail('报告状态已变更，请刷新后重试')
    log_action(db, user['id'], '提交措施审批', 'report', rid,
               {'report_id': rid, 'count': len(measures)})
    db.commit()
    return ok({'id': rid, 'status': new_status})


@bp.patch('/measures/<int:mid>/deadline')
@role_required('teacher')
def patch_deadline(mid):
    user = request.current_user
    db = get_db()
    measure = db.execute('SELECT * FROM measures WHERE id=?', (mid,)).fetchone()
    if measure is None:
        return fail('措施不存在', 404)
    report = get_report(db, measure['report_id'])
    if report['teacher_id'] != user['id']:
        return fail('无权限操作该措施', 403)
    if report['status'] != 'executing':
        return fail('仅执行中的报告可修改截止时间')

    body = request.get_json(silent=True) or {}
    deadline = str(body.get('deadline') or '').strip()
    try:
        datetime.strptime(deadline, '%Y-%m-%d')
    except ValueError:
        return fail('截止时间格式应为 YYYY-MM-DD')

    # 审批指派后报告已是 executing，改期不再触发状态迁移
    cur = db.execute('UPDATE reports SET updated_at=? WHERE id=? AND status=?',
                     (now(), report['id'], report['status']))
    if cur.rowcount == 0:
        return fail('报告状态已变更，请刷新后重试')
    db.execute('UPDATE measures SET deadline=? WHERE id=?', (deadline, mid))
    log_action(db, user['id'], '修改截止时间', 'report', report['id'],
               {'report_id': report['id'], 'measure_id': mid, 'deadline': deadline})
    db.commit()
    return ok({'id': mid, 'deadline': deadline, 'report_status': report['status']})


@bp.get('/measures/mine')
@role_required('teacher')
def my_measures():
    """我的任务：分配给我且报告未定级的措施，附达成状态与最新打回原因，按截止升序"""
    user = request.current_user
    db = get_db()
    rows = db.execute(
        'SELECT m.id, m.seq, m.content, m.verify_indicator, m.deadline, '
        'r.id AS report_id, r.title AS report_title, r.status AS report_status, '
        "c.name AS course_name, c.academic_year, c.term, "
        'a.status AS achievement_status, a.id AS achievement_id, '
        'a.content AS achievement_content '
        'FROM measures m JOIN reports r ON m.report_id=r.id '
        'JOIN courses c ON r.course_id=c.id '
        'LEFT JOIN achievements a ON a.measure_id=m.id '
        "WHERE m.assignee_id=? AND r.status!='concluded' "
        'ORDER BY COALESCE(m.deadline, \'9999-12-31\'), m.id',
        (user['id'],)).fetchall()
    ach_ids = [r['achievement_id'] for r in rows if r['achievement_id'] is not None]
    latest_reject = {}
    if ach_ids:
        ph = ','.join('?' * len(ach_ids))
        latest_reject = {r['target_id']: r['reason'] for r in db.execute(
            f"SELECT target_id, reason FROM rejections WHERE target_type='achievement' "
            f'AND target_id IN ({ph}) AND id IN ('
            f"SELECT MAX(id) FROM rejections WHERE target_type='achievement' "
            f'AND target_id IN ({ph}) GROUP BY target_id)', ach_ids + ach_ids).fetchall()}
    items = []
    for r in rows:
        status = r['achievement_status']
        items.append({
            'measure_id': r['id'], 'seq': r['seq'], 'content': r['content'],
            'verify_indicator': r['verify_indicator'], 'deadline': r['deadline'],
            'report_id': r['report_id'], 'report_title': r['report_title'],
            'course_name': r['course_name'], 'academic_year': r['academic_year'],
            'term': r['term'], 'report_status': r['report_status'],
            'achievement_status': status,
            'achievement_id': r['achievement_id'],
            'achievement_content': r['achievement_content'],
            'returned_reason': latest_reject.get(r['achievement_id'])
            if status == 'returned' else None,
        })
    return ok(items)


@bp.post('/measures/<int:mid>/achievement')
@role_required('teacher')
def submit_measure_achievement(mid):
    """按措施提交/重提达成报告（仅该措施责任人本人，报告须处于 executing）。

    新建或覆盖重提（content 覆盖，status='submitted'，记录 submitter_id/submitted_at），
    历史打回原因保留在 rejections 中。
    """
    user = request.current_user
    db = get_db()
    measure = db.execute('SELECT * FROM measures WHERE id=?', (mid,)).fetchone()
    if measure is None:
        return fail('措施不存在', 404)
    if measure['assignee_id'] != user['id']:
        return fail('仅该措施的责任人可提交达成报告', 403)
    report = get_report(db, measure['report_id'])
    if report is None:
        return fail('报告不存在', 404)
    if report['status'] != 'executing':
        return fail(f"当前状态「{STATUS_LABELS.get(report['status'], report['status'])}」"
                    '不允许提交达成报告')

    body = request.get_json(silent=True) or {}
    content = str(body.get('content') or '').strip()
    if not content:
        return fail('请填写达成报告内容')

    deadline = (measure['deadline'] or '').strip()
    if deadline:
        try:
            if date.today() > date.fromisoformat(deadline):
                return fail(f'已超过该措施截止时间（{deadline}），无法提交达成报告')
        except ValueError:
            pass

    ach = db.execute('SELECT * FROM achievements WHERE measure_id=?', (mid,)).fetchone()
    if ach is None:
        cur = db.execute(
            'INSERT INTO achievements (measure_id, report_id, submitter_id, content, '
            "status, submitted_at) VALUES (?, ?, ?, ?, 'submitted', ?)",
            (mid, report['id'], user['id'], content, now()))
        achievement_id = cur.lastrowid
        action = '提交达成报告'
    else:
        # 守卫：禁止把已 approved 的达成重置回 submitted（条件 UPDATE + rowcount 防并发）
        cur = db.execute(
            "UPDATE achievements SET content=?, status='submitted', submitter_id=?, "
            "submitted_at=? WHERE id=? AND status!='approved'",
            (content, user['id'], now(), ach['id']))
        if cur.rowcount == 0:
            return fail('该达成报告已通过审批，不可重新提交')
        achievement_id = ach['id']
        action = '重新提交达成报告'
    log_action(db, user['id'], action, 'report', report['id'],
               {'report_id': report['id'], 'measure_id': mid,
                'achievement_id': achievement_id})
    db.commit()
    return ok({'achievement_id': achievement_id, 'status': 'submitted'})


# ---------------------------------------------------------------------------
# 下载端点
# ---------------------------------------------------------------------------

def _can_access_report(user, report):
    """报告访问鉴权：创建教师本人 或 专业负责人 或 管理员"""
    return (report['teacher_id'] == user['id']
            or user['is_leader'] or user['is_admin'])


@bp.get('/reports/<int:rid>/file')
@login_required
def report_file(rid):
    """以内联方式返回原始 .docx 文件流，供前端 docx-preview 在浏览器内渲染。

    鉴权与 download 一致（创建教师本人 / 负责人 / 管理员）；预览属于轻量
    读取操作，不写审计日志。Content-Disposition: inline 避免触发下载。
    """
    user = request.current_user
    db = get_db()
    report = get_report(db, rid)
    if report is None:
        return fail('报告不存在', 404)
    if not _can_access_report(user, report):
        return fail('无权限查看该报告', 403)

    file_path = report['file_path'] or ''
    if report['source'] != 'upload' or not file_path or not os.path.exists(file_path):
        return fail('原始文件不存在', 404)

    # 安全：仅取 basename，避免路径穿越；实际从受控 UPLOAD_DIR 读取
    stored_name = os.path.basename(file_path)
    return send_from_directory(config.UPLOAD_DIR, stored_name, as_attachment=False)


@bp.get('/reports/<int:rid>/download')
@login_required
def download_report(rid):
    """下载原始 Word 报告文件（仅 source='upload' 且磁盘文件存在）"""
    user = request.current_user
    db = get_db()
    report = get_report(db, rid)
    if report is None:
        return fail('报告不存在', 404)
    if not _can_access_report(user, report):
        return fail('无权限下载该报告', 403)

    file_path = report['file_path'] or ''
    if report['source'] != 'upload' or not file_path or not os.path.exists(file_path):
        return fail('原始文件不存在或为历史导入记录', 404)

    # 安全：仅取 basename，避免路径穿越；实际从受控 UPLOAD_DIR 读取
    stored_name = os.path.basename(file_path)
    download_name = report['title'] + config.ALLOWED_REPORT_EXT
    resp = send_from_directory(
        config.UPLOAD_DIR, stored_name,
        as_attachment=True, download_name=download_name)
    # Werkzeug 依据 download_name 自动写出 filename + RFC 5987 filename*（UTF-8），
    # 兼容中文文件名的 Content-Disposition。
    log_action(db, user['id'], 'download_report', 'report', rid,
               {'report_id': rid, 'title': report['title']})
    db.commit()
    return resp


# Word 文档命名空间与 docx 包固定骨架
_W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
_CONTENT_TYPES = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    '</Types>'
)
_ROOT_RELS = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    '</Relationships>'
)
_WORD_RELS = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '</Relationships>'
)
# 表格 5 列宽度（dxa）：序号 / 改进措施内容 / 验证指标 / 责任人 / 截止时间
_COL_WIDTHS = (700, 4600, 2500, 1200, 1500)
_HEADERS = ('序号', '改进措施内容', '验证指标', '责任人', '截止时间')
_MAX_CONTENT_LEN = 500


def _docx_cell(text, width, bold=False, fill=None):
    """构建一个表格单元格 <w:tc>，文本做 XML 转义并保留空白"""
    shd = f'<w:shd w:val="clear" w:color="auto" w:fill="{fill}"/>' if fill else ''
    rpr = '<w:rPr><w:b/></w:rPr>' if bold else ''
    safe = escape(text if text is not None else '')
    return (
        f'<w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/>{shd}</w:tcPr>'
        f'<w:p><w:r>{rpr}<w:t xml:space="preserve">{safe}</w:t></w:r></w:p></w:tc>'
    )


def _docx_row(cells_xml):
    return f'<w:tr>{cells_xml}</w:tr>'


def _generate_measures_docx(report_title, measures):
    """生成改进措施 .docx，返回 bytes（标准库 zipfile 打包 OOXML 骨架）"""
    grid = ''.join(f'<w:gridCol w:w="{w}"/>' for w in _COL_WIDTHS)
    borders = (
        '<w:tblBorders>'
        + ''.join(f'<w:{e} w:val="single" w:sz="4" w:space="0" w:color="auto"/>'
                  for e in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'))
        + '</w:tblBorders>'
    )
    tbl_pr = f'<w:tblPr><w:tblW w:w="0" w:type="auto"/>{borders}</w:tblPr>'

    # 表头行（灰底加粗）
    header_cells = ''.join(
        _docx_cell(h, _COL_WIDTHS[i], bold=True, fill='D9D9D9')
        for i, h in enumerate(_HEADERS))
    rows_xml = [_docx_row(header_cells)]

    # 数据行
    for idx, m in enumerate(measures, start=1):
        content = (m['content'] or '').strip()
        if len(content) > _MAX_CONTENT_LEN:
            content = content[:_MAX_CONTENT_LEN] + '…'
        deadline = (m['deadline'] or '').strip() or '无'
        cells = (
            _docx_cell(str(idx), _COL_WIDTHS[0])
            + _docx_cell(content, _COL_WIDTHS[1])
            + _docx_cell((m['verify_indicator'] or '').strip(), _COL_WIDTHS[2])
            + _docx_cell((m['assignee_name'] or '').strip(), _COL_WIDTHS[3])
            + _docx_cell(deadline, _COL_WIDTHS[4])
        )
        rows_xml.append(_docx_row(cells))

    title_p = (
        '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>'
        '<w:r><w:rPr><w:b/><w:sz w:val="36"/></w:rPr>'
        f'<w:t xml:space="preserve">{escape(report_title or "")}</w:t></w:r></w:p>'
    )
    tbl = f'<w:tbl>{tbl_pr}<w:tblGrid>{grid}</w:tblGrid>{"".join(rows_xml)}</w:tbl>'
    sect = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
    sect += '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" '
    sect += 'w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
    document_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<w:document xmlns:w="{_W_NS}"><w:body>'
        f'{title_p}{tbl}{sect}'
        '</w:body></w:document>'
    )

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr('[Content_Types].xml', _CONTENT_TYPES)
        zf.writestr('_rels/.rels', _ROOT_RELS)
        zf.writestr('word/_rels/document.xml.rels', _WORD_RELS)
        zf.writestr('word/document.xml', document_xml)
    return buf.getvalue()


@bp.get('/reports/<int:rid>/measures-download')
@login_required
def download_measures(rid):
    """下载改进措施 Word 文档（服务端动态生成 .docx）"""
    user = request.current_user
    db = get_db()
    report = get_report(db, rid)
    if report is None:
        return fail('报告不存在', 404)
    if not _can_access_report(user, report):
        return fail('无权限下载该报告的措施', 403)

    rows = db.execute(
        'SELECT m.id, m.content, m.verify_indicator, m.assignee_id, m.deadline, '
        'u.real_name AS assignee_name FROM measures m '
        'LEFT JOIN users u ON m.assignee_id = u.id '
        'WHERE m.report_id = ? ORDER BY m.id', (rid,)).fetchall()
    measures = [dict(r) for r in rows]
    if not measures:
        return fail('暂无改进措施，无法下载', 400)

    data = _generate_measures_docx(report['title'], measures)
    download_name = report['title'] + '_改进措施.docx'
    log_action(db, user['id'], 'download_measures', 'report', rid,
               {'report_id': rid, 'title': report['title'], 'count': len(measures)})
    db.commit()
    return send_file(
        io.BytesIO(data), as_attachment=True, download_name=download_name,
        mimetype='application/vnd.openxmlformats-officedocument.wordprocessingml.document')
