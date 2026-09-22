# -*- coding: utf-8 -*-
"""负责人端蓝图：待办、措施审批通过/退回、达成报告逐份通过/打回、整体定级"""
from datetime import datetime

from flask import Blueprint, request

import config
from auth import ok, fail, role_required
from db import get_db, log_action, now, get_report, get_measures
from services.state_machine import transition, IllegalTransitionError

bp = Blueprint('approvals', __name__, url_prefix='/api')


def _brief(r):
    return {
        'id': r['id'], 'title': r['title'], 'status': r['status'],
        'source': r['source'], 'created_at': r['created_at'],
        'course_name': r['course_name'], 'course_code': r['course_code'],
        'academic_year': r['academic_year'], 'term': r['term'],
        'teacher_id': r['teacher_id'], 'teacher_name': r['teacher_name'],
    }


def _check_leader_scope(report, user):
    """报告已指派负责人时，仅指派的负责人可审批；未指派（NULL）任何负责人均可"""
    if report['leader_id'] is not None and report['leader_id'] != user['id']:
        return fail('该报告已指派给其他负责人审批', 403)
    return None


@bp.get('/leader/pending')
@role_required('leader')
def pending():
    db = get_db()
    uid = request.current_user['id']
    sql = ('SELECT r.*, u.real_name AS teacher_name, c.name AS course_name, '
           'c.code AS course_code, c.academic_year, c.term '
           'FROM reports r JOIN users u ON r.teacher_id=u.id '
           'JOIN courses c ON r.course_id=c.id WHERE r.status=? '
           'AND (r.leader_id IS NULL OR r.leader_id=?) '
           'ORDER BY r.updated_at, r.id')
    pending_measures = [_brief(r) for r in db.execute(sql, ('submitted', uid)).fetchall()]

    # 待审达成：执行中报告且（有待审达成 或 已全部通过可定级）。
    # 入选放宽后，全部通过的报告仍留在列表并 ready_to_conclude=True，供负责人整体定级。
    # 每份执行中报告只跑一次聚合子查询（合并 total/submitted/approved/not_approved），
    # 复用同一 executing 结果集，避免 N+1 与对同一结果集重复执行 SQL。
    pending_achievements = []
    for r in db.execute(sql, ('executing', uid)).fetchall():
        stats = db.execute(
            'SELECT '
            '(SELECT COUNT(*) FROM measures m WHERE m.report_id=?) AS total, '
            '(SELECT COUNT(*) FROM measures m WHERE m.report_id=? AND NOT EXISTS '
            "(SELECT 1 FROM achievements a WHERE a.measure_id=m.id "
            "AND a.status='approved')) AS not_approved, "
            "(SELECT COUNT(*) FROM achievements a WHERE a.report_id=? "
            "AND a.status='submitted') AS submitted, "
            "(SELECT COUNT(*) FROM achievements a WHERE a.report_id=? "
            "AND a.status='approved') AS approved",
            (r['id'], r['id'], r['id'], r['id'])).fetchone()
        total = stats['total']
        submitted = stats['submitted']
        approved = stats['approved']
        ready_to_conclude = total > 0 and stats['not_approved'] == 0
        if submitted == 0 and not ready_to_conclude:
            continue
        item = _brief(r)
        item['submitted_count'] = submitted
        item['total_measures'] = total
        item['approved_count'] = approved
        item['ready_to_conclude'] = ready_to_conclude
        pending_achievements.append(item)
    return ok({'pending_measures': pending_measures,
               'pending_achievements': pending_achievements})


@bp.post('/reports/<int:rid>/approve')
@role_required('leader')
def approve(rid):
    user = request.current_user
    db = get_db()
    report = get_report(db, rid)
    if report is None:
        return fail('报告不存在', 404)
    scope_err = _check_leader_scope(report, user)
    if scope_err:
        return scope_err

    measures = get_measures(db, rid)
    if not measures:
        return fail('该报告没有措施，无法审批')

    body = request.get_json(silent=True) or {}
    assignments = body.get('assignments')
    if assignments is None:
        assignments = []
    if not isinstance(assignments, list):
        return fail('指派数据格式错误')
    assign_map = {}
    for a in assignments:
        if not isinstance(a, dict) or a.get('measure_id') is None or a.get('assignee_id') is None:
            return fail('指派数据格式错误')
        try:
            assign_map[int(a['measure_id'])] = int(a['assignee_id'])
        except (TypeError, ValueError):
            return fail('指派数据格式错误')

    valid_users = {r['id']: r for r in db.execute(
        'SELECT id, is_teacher, is_disabled FROM users').fetchall()}

    # 执行截止时间由负责人审批时逐条手动设置，不再使用 DEFAULT_MEASURE_DEADLINE 自动兜底。
    # 请求体格式：{"deadlines": {"<measure_id>": "YYYY-MM-DD", ...}}
    deadlines = body.get('deadlines')
    if not isinstance(deadlines, dict) or not deadlines:
        return fail('请为每条措施设置执行截止时间')
    deadline_map = {}
    for key, val in deadlines.items():
        try:
            deadline_map[int(key)] = str(val or '').strip()
        except (TypeError, ValueError):
            return fail('截止时间数据的措施编号非法')
    missing, bad_fmt = [], []
    for m in measures:
        dl = deadline_map.get(m['id'], '')
        if not dl:
            missing.append(m)
            continue
        try:
            datetime.strptime(dl, '%Y-%m-%d')
        except ValueError:
            bad_fmt.append(m)
    if missing:
        return fail('请为每条措施设置执行截止时间（第 %s 条缺失）'
                    % '、'.join(str(i + 1) for i, m in enumerate(measures) if m in missing))
    if bad_fmt:
        return fail('执行截止时间格式应为 YYYY-MM-DD（第 %s 条不合法）'
                    % '、'.join(str(i + 1) for i, m in enumerate(measures) if m in bad_fmt))

    # 指派强校验：每条措施必须同时有责任人（限启用中的教师）和截止时间，
    # 保证审批后每条措施都可分发给责任人逐条填写达成报告。
    for m in measures:
        assignee_id = assign_map.get(m['id'])
        if not assignee_id:
            return fail(f"措施「{m['content'][:20]}…」未指派责任人")
        assignee = valid_users.get(assignee_id)
        if assignee is None:
            return fail('指派的责任人不存在')
        if not assignee['is_teacher']:
            return fail('责任人必须为教师')
        if assignee['is_disabled']:
            return fail('责任人账号已停用，请改派其他教师')

    try:
        new_status = transition(report['status'], 'approve')
    except IllegalTransitionError as e:
        return fail(str(e))

    cur = db.execute('UPDATE reports SET status=?, updated_at=? WHERE id=? AND status=?',
                     (new_status, now(), rid, report['status']))
    if cur.rowcount == 0:
        return fail('报告状态已变更，请刷新后重试')
    for m in measures:
        db.execute(
            "UPDATE measures SET assignee_id=?, deadline=?, status='assigned' WHERE id=?",
            (assign_map[m['id']], deadline_map[m['id']], m['id']))
    log_action(db, user['id'], '审批通过并指派责任人', 'report', rid,
               {'report_id': rid, 'assignments': assignments,
                'deadlines': deadlines})
    db.commit()
    return ok({'id': rid, 'status': new_status, 'deadlines': deadlines})


@bp.post('/reports/<int:rid>/reject')
@role_required('leader')
def reject_measures(rid):
    user = request.current_user
    db = get_db()
    report = get_report(db, rid)
    if report is None:
        return fail('报告不存在', 404)
    scope_err = _check_leader_scope(report, user)
    if scope_err:
        return scope_err

    body = request.get_json(silent=True) or {}
    reason = str(body.get('reason') or '').strip()
    if not reason:
        return fail('请填写退回原因')

    try:
        new_status = transition(report['status'], 'reject_measures')
    except IllegalTransitionError as e:
        return fail(str(e))

    cur = db.execute('UPDATE reports SET status=?, updated_at=? WHERE id=? AND status=?',
                     (new_status, now(), rid, report['status']))
    if cur.rowcount == 0:
        return fail('报告状态已变更，请刷新后重试')
    db.execute(
        "INSERT INTO rejections (target_type, target_id, reason, rejecter_id, created_at) "
        "VALUES ('measures', ?, ?, ?, ?)",
        (rid, reason, user['id'], now()))
    log_action(db, user['id'], '退回措施', 'report', rid,
               {'report_id': rid, 'reason': reason})
    db.commit()
    return ok({'id': rid, 'status': new_status})


@bp.post('/achievements/<int:aid>/approve')
@role_required('leader')
def approve_achievement(aid):
    """逐份通过达成报告（achievements.status: submitted → approved，报告状态不动）"""
    user = request.current_user
    db = get_db()
    ach = db.execute('SELECT * FROM achievements WHERE id=?', (aid,)).fetchone()
    if ach is None:
        return fail('达成报告不存在', 404)
    report = get_report(db, ach['report_id'])
    if report is None:
        return fail('报告不存在', 404)
    scope_err = _check_leader_scope(report, user)
    if scope_err:
        return scope_err
    if ach['status'] != 'submitted':
        return fail('仅待审核的达成报告可通过')

    cur = db.execute(
        "UPDATE achievements SET status='approved' WHERE id=? AND status='submitted'",
        (aid,))
    if cur.rowcount == 0:
        return fail('达成报告状态已变更，请刷新后重试')
    log_action(db, user['id'], '通过达成报告', 'report', report['id'],
               {'report_id': report['id'], 'achievement_id': aid,
                'measure_id': ach['measure_id']})
    db.commit()
    return ok({'id': aid, 'status': 'approved', 'report_id': report['id']})


@bp.post('/achievements/<int:aid>/reject')
@role_required('leader')
def reject_achievement(aid):
    """打回达成报告（achievements.status → returned，打回给该措施责任人修改重提，
    报告状态不动）；打回原因写入 rejections(target_type='achievement')历史"""
    user = request.current_user
    db = get_db()
    ach = db.execute('SELECT * FROM achievements WHERE id=?', (aid,)).fetchone()
    if ach is None:
        return fail('达成报告不存在', 404)
    report = get_report(db, ach['report_id'])
    if report is None:
        return fail('报告不存在', 404)
    scope_err = _check_leader_scope(report, user)
    if scope_err:
        return scope_err
    if ach['status'] != 'submitted':
        return fail('仅待审核的达成报告可打回')

    body = request.get_json(silent=True) or {}
    reason = str(body.get('reason') or '').strip()
    if not reason:
        return fail('请填写打回原因')

    cur = db.execute(
        "UPDATE achievements SET status='returned' WHERE id=? AND status='submitted'",
        (aid,))
    if cur.rowcount == 0:
        return fail('达成报告状态已变更，请刷新后重试')
    db.execute(
        "INSERT INTO rejections (target_type, target_id, reason, rejecter_id, created_at) "
        "VALUES ('achievement', ?, ?, ?, ?)",
        (aid, reason, user['id'], now()))
    log_action(db, user['id'], '打回达成报告', 'report', report['id'],
               {'report_id': report['id'], 'achievement_id': aid,
                'measure_id': ach['measure_id'], 'reason': reason})
    db.commit()
    return ok({'id': aid, 'status': 'returned'})


@bp.post('/reports/<int:rid>/conclude')
@role_required('leader')
def conclude(rid):
    """整体定级：全部措施的达成报告均已 approved 后，executing → concluded，
    结论写入 reports.conclusion（替代旧 POST /api/achievements/<aid>/conclude）"""
    user = request.current_user
    db = get_db()
    report = get_report(db, rid)
    if report is None:
        return fail('报告不存在', 404)
    scope_err = _check_leader_scope(report, user)
    if scope_err:
        return scope_err

    body = request.get_json(silent=True) or {}
    final_result = str(body.get('final_result') or '').strip()
    if final_result not in config.CONCLUSION_OPTIONS:
        return fail(f"结论必须为：{'/'.join(config.CONCLUSION_OPTIONS)}")

    # 先算未通过条数供文案（不参与守卫原子性，仅用于 rowcount==0 时区分错误提示）
    not_approved = db.execute(
        'SELECT COUNT(*) AS c FROM measures m WHERE m.report_id=? AND NOT EXISTS '
        "(SELECT 1 FROM achievements a WHERE a.measure_id=m.id AND a.status='approved')",
        (rid,)).fetchone()['c']

    try:
        new_status = transition(report['status'], 'conclude')
    except IllegalTransitionError as e:
        return fail(str(e))

    # 原子守卫：把"全部措施达成均已 approved"并入条件 UPDATE 的 WHERE（NOT EXISTS 子查询），
    # 单条 SQL 完成校验 + 状态迁移（WHERE status='executing' 防并发重复定级），
    # 消除 check-then-act 竞态。
    cur = db.execute(
        'UPDATE reports SET status=?, conclusion=?, concluded_at=?, updated_at=? '
        "WHERE id=? AND status='executing' AND NOT EXISTS ("
        'SELECT 1 FROM measures m WHERE m.report_id=? AND NOT EXISTS ('
        "SELECT 1 FROM achievements a WHERE a.measure_id=m.id AND a.status='approved'))",
        (new_status, final_result, now(), now(), rid, rid))
    if cur.rowcount == 0:
        if not_approved:
            return fail(f'仍有 {not_approved} 条措施的达成报告未通过审批')
        return fail('报告状态已变更，请刷新后重试')
    log_action(db, user['id'], '定级', 'report', rid,
               {'report_id': rid, 'final_result': final_result})
    db.commit()
    return ok({'id': rid, 'status': new_status, 'conclusion': final_result})
