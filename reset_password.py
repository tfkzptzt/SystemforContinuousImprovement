# -*- coding: utf-8 -*-
"""命令行密码重置脚本（管理员使用）

用法：python reset_password.py <username> <new_password>
"""
import os
import sys
import sqlite3

from werkzeug.security import generate_password_hash

import config

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATABASE = os.path.join(BASE_DIR, 'data.db')


def main():
    if len(sys.argv) != 3:
        print('用法：python reset_password.py <username> <new_password>')
        sys.exit(1)

    username = sys.argv[1]
    new_password = sys.argv[2]

    if len(new_password) < config.MIN_PASSWORD_LEN:
        print(f'错误：新密码长度至少{config.MIN_PASSWORD_LEN}位')
        sys.exit(1)

    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    try:
        user = conn.execute('SELECT id, real_name FROM users WHERE username = ?',
                            (username,)).fetchone()
        if user is None:
            print(f'错误：用户 "{username}" 不存在')
            sys.exit(1)

        hashed = generate_password_hash(new_password)
        conn.execute('UPDATE users SET password_hash = ? WHERE id = ?',
                     (hashed, user['id']))
        conn.commit()
        print(f'密码已重置：用户名 {username}，新密码 {new_password}')
    finally:
        conn.close()


if __name__ == '__main__':
    main()
