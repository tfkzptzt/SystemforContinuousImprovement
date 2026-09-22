# -*- coding: utf-8 -*-
"""应用工厂入口：注册全部蓝图，统一 JSON 错误处理"""
import os

from flask import Flask, jsonify, render_template
from flask_limiter.errors import RateLimitExceeded
from werkzeug.exceptions import HTTPException

import config
import db as db_mod
import auth
import api_reports
import api_approvals
import api_admin
import api_manage
from ratelimit import limiter
from services import importer


def create_app():
    app = Flask(__name__)
    app.config['SECRET_KEY'] = config.SECRET_KEY
    app.config['MAX_CONTENT_LENGTH'] = config.MAX_CONTENT_LENGTH
    app.config['RATELIMIT_ENABLED'] = config.RATELIMIT_ENABLED

    # 登录限速（按 IP+用户名，参数在 auth.login 处动态从 settings 表解析）
    limiter.init_app(app)

    os.makedirs(config.UPLOAD_DIR, exist_ok=True)
    importer.ensure_import_template()

    # 每请求一连接，请求结束关闭
    app.teardown_appcontext(db_mod.close_db)

    # 注册蓝图
    app.register_blueprint(auth.bp)
    app.register_blueprint(auth.user_bp)
    app.register_blueprint(api_reports.bp)
    app.register_blueprint(api_approvals.bp)
    app.register_blueprint(api_admin.bp)
    app.register_blueprint(api_manage.bp)

    @app.route('/')
    def index():
        return render_template('index.html')

    # 统一错误处理：一律返回 JSON
    @app.errorhandler(RateLimitExceeded)
    def handle_rate_limit(e):
        return jsonify({'ok': False, 'error': '尝试次数过多，账号已被临时锁定，请稍后重试'}), 429

    @app.errorhandler(HTTPException)
    def handle_http_error(e):
        if e.code == 413:
            msg = f'文件大小超过 {config.MAX_UPLOAD_MB}MB 限制'
        elif e.code == 404:
            msg = '资源不存在'
        elif e.code == 405:
            msg = '请求方法不允许'
        else:
            msg = e.description or '请求错误'
        return jsonify({'ok': False, 'error': msg}), e.code

    @app.errorhandler(Exception)
    def handle_error(e):
        app.logger.exception('未处理异常')
        return jsonify({'ok': False, 'error': '服务器内部错误，请稍后重试'}), 500

    return app


app = create_app()

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000, debug=False)
