# -*- coding: utf-8 -*-
"""集中式报告状态机：报告状态唯一存于 reports.status

状态链：
draft → measures_generated → submitted → (returned ⇄ submitted) → executing → concluded

说明：
- approve（负责人审批指派）直接 submitted → executing，措施分发给责任人后即进入执行阶段；
- 达成报告按措施一对一挂 measures，其生命周期由 achievements.status 承担
  （submitted ⇄ returned → approved），不再占用报告级状态；
- conclude（负责人整体定级）要求该报告全部措施的达成报告均已 approved（守卫在
  api_approvals 中），条件 UPDATE executing → concluded 防并发重复定级。
"""

# 事件 → {当前状态: 迁移后状态}
TRANSITIONS = {
    # 智能/手动生成改进措施（草稿、已生成、被退回后均可重新生成）
    'generate': {
        'draft': 'measures_generated',
        'measures_generated': 'measures_generated',
        'returned': 'measures_generated',
    },
    # 提交措施审批（首次提交 / 退回后重新提交）
    'submit_measures': {
        'measures_generated': 'submitted',
        'returned': 'submitted',
    },
    # 负责人退回措施
    'reject_measures': {
        'submitted': 'returned',
    },
    # 负责人审批通过并指派责任人，措施分发即进入执行阶段
    'approve': {
        'submitted': 'executing',
    },
    # 负责人整体定级（守卫：全部措施达成报告已 approved），流程结束
    'conclude': {
        'executing': 'concluded',
    },
}

STATUS_LABELS = {
    'draft': '草稿',
    'measures_generated': '已生成措施',
    'submitted': '待审批',
    'returned': '已退回',
    'executing': '执行中',
    'concluded': '已定级',
}


class IllegalTransitionError(Exception):
    """非法状态迁移"""

    def __init__(self, current_status, event):
        self.current_status = current_status
        self.event = event
        super().__init__(
            f"非法状态迁移：当前状态「{STATUS_LABELS.get(current_status, current_status)}」"
            f"不允许执行操作「{event}」"
        )


def can_transition(current_status, event):
    return current_status in TRANSITIONS.get(event, {})


def transition(current_status, event):
    """执行状态迁移，非法迁移抛出 IllegalTransitionError，返回新状态"""
    targets = TRANSITIONS.get(event)
    if not targets or current_status not in targets:
        raise IllegalTransitionError(current_status, event)
    return targets[current_status]
