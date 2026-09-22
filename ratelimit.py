# -*- coding: utf-8 -*-
"""登录限速：基于 flask-limiter 的内存态限速器（单进程足够，演示/中小规模）

限速策略在 auth.login 处声明为动态 callable，从 settings 表读取
"最大尝试次数 + 锁定时长"，按 IP+用户名 组合键计数，连续失败达上限即临时封锁。
"""
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

limiter = Limiter(key_func=get_remote_address, storage_uri='memory://')
