"""Deploy via SSH. Requires paramiko; pass WAIQI_SSH_PASSWORD in the environment."""
import io
import json
import os
from pathlib import Path
import shlex
import subprocess
import tarfile
import time
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
HOST = os.environ.get("WAIQI_SSH_HOST", "154.94.226.162")
DOMAIN = os.environ.get("WAIQI_DOMAIN", "jobenglish.pro")
client = paramiko.SSHClient()
client.load_system_host_keys()
client.load_host_keys(str(Path.home() / ".ssh" / "known_hosts"))
client.connect(HOST, username="root", password=os.environ["WAIQI_SSH_PASSWORD"], timeout=20, look_for_keys=False, allow_agent=False)


def run(command, timeout=900):
    _, stdout, stderr = client.exec_command(command, timeout=timeout)
    for line in stdout:
        print(line.rstrip(), flush=True)
    errors = stderr.read().decode(errors="replace")
    code = stdout.channel.recv_exit_status()
    if errors:
        print(errors, flush=True)
    if code:
        raise RuntimeError(f"Remote command failed ({code})")


def write(path, content, mode=0o600):
    with client.open_sftp() as sftp:
        with sftp.file(path, "wb") as target:
            target.write(content.encode() if isinstance(content, str) else content)
        sftp.chmod(path, mode)


try:
    providers = {}
    for line in (ROOT / ".env").read_text(encoding="utf-8-sig").splitlines():
        if "=" not in line or line.startswith("#"):
            continue
        key, value = line.split("=", 1)
        if key.startswith(("LLM_", "TTS_", "MEMORY_")):
            providers[key] = value.strip().strip('"').strip("'")
    release = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
    remote = f"/opt/waiqiEnglish/releases/{release}"
    files = subprocess.check_output(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=ROOT).decode().split("\0")
    archive = io.BytesIO()
    with tarfile.open(fileobj=archive, mode="w:gz") as tar:
        for filename in sorted(set(files)):
            if filename and (ROOT / filename).is_file() and not filename.startswith((".env", "docs/", "miniprogram/")):
                tar.add(ROOT / filename, arcname=filename, recursive=False)
    write("/tmp/waiqi-release.tar.gz", archive.getvalue())
    # Credentials travel only over SSH and remain outside the repository/releases.
    bootstrap = """import json, pathlib, secrets, subprocess
p=pathlib.Path('/etc/waiqiEnglish.env')
env={}
if p.exists():
 for line in p.read_text().splitlines():
  if '=' in line:
   key,value=line.split('=',1);env[key]=value
env.setdefault('DB_PASSWORD',secrets.token_urlsafe(32))
env.setdefault('ADMIN_PASSWORD',secrets.token_urlsafe(24))
env.setdefault('BETTER_AUTH_SECRET',secrets.token_urlsafe(48))
env.update(PROVIDERS)
env.update({'HOST':'127.0.0.1','PORT':'8838','DB_DRIVER':'postgres','DATABASE_SSL':'false','DATABASE_URL':'postgresql://waiqi:'+env['DB_PASSWORD']+'@127.0.0.1:5432/waiqi','AUTH_PROVIDER':'better-auth','BETTER_AUTH_URL':'https://DOMAIN','AUDIO_STORAGE':'local','DATA_DIR':'/srv/waiqi-data','ADMIN_USERNAME':'admin','ALLOW_DEV_LOGIN':'false','PRIVACY_POLICY_CONFIRMED':'true','CONTENT_SAFETY_PROVIDER':'llm','NODE_ENV':'production'})
p.write_text(''.join(key+'='+value+'\\n' for key,value in env.items()))
p.chmod(0o640)
subprocess.run(['chown','root:waiqi',str(p)],check=True)
sql="SELECT 'CREATE ROLE waiqi LOGIN PASSWORD ''"+env['DB_PASSWORD']+"''' WHERE NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='waiqi');\\n\\\\gexec\\nSELECT 'CREATE DATABASE waiqi OWNER waiqi' WHERE NOT EXISTS(SELECT 1 FROM pg_database WHERE datname='waiqi');\\n\\\\gexec\\n"
subprocess.run(['runuser','-u','postgres','--','psql','-v','ON_ERROR_STOP=1'],input=sql,text=True,check=True,stdout=subprocess.DEVNULL)
print('Database role and private environment prepared.')
""".replace("PROVIDERS", repr(providers)).replace("DOMAIN", DOMAIN)
    write("/tmp/waiqi-bootstrap.py", bootstrap)
    run("python3 /tmp/waiqi-bootstrap.py")
    run("if test -x /usr/local/sbin/waiqi-backup; then /usr/local/sbin/waiqi-backup; fi")
    run(f"install -d -m 750 -o waiqi -g waiqi {shlex.quote(remote)} && tar -xzf /tmp/waiqi-release.tar.gz -C {shlex.quote(remote)} && chown -R waiqi:waiqi {shlex.quote(remote)} && cd {shlex.quote(remote)} && runuser -u waiqi -- pnpm install --frozen-lockfile && runuser -u waiqi -- pnpm build && runuser -u waiqi -- node --env-file=/etc/waiqiEnglish.env scripts/setup-web.mjs")
    privacy = """职场英语搭子隐私与 AI 使用说明
本网站由站点运营者提供。注册只需用户名、密码和确认密码，不收集邮箱，不发送验证邮件。密码由 Better Auth 哈希保存，网站不会保存明文密码。忘记密码时使用你自行保管的一次性恢复码。
我们在此服务器的 PostgreSQL 中保存账号资料、聊天记录、收藏、偏好、反馈及你授权提取的记忆，音频保存在服务器数据盘。对话内容和相关记忆会发送给 DeepSeek API 用于回复、英译、记忆提取和模型辅助内容检查；请求朗读的文本会发送给阿里云语音服务。AI 结果可能出错，不能替代专业意见。
模型辅助内容检查不是人工审核，也不保证识别所有风险。请勿输入密码、支付凭证、身份证号或他人敏感资料。浏览器通过 HTTPS 连接服务器；会话使用 HttpOnly Cookie。
你可以在「我的」关闭记忆，在「我的记忆」更正或删除记忆，删除对话，或注销账号。注销会删除业务记录和账号凭证；数据库备份仅用于故障恢复，最多保留14天，不用于继续提供个性化服务。
站内问题可通过「我的」中的反馈提交运营者处理。当前没有外部广告追踪。"""
    write("/tmp/waiqi-privacy.json", json.dumps(privacy, ensure_ascii=False))
    run(f"cd {shlex.quote(remote)} && node --env-file=/etc/waiqiEnglish.env --input-type=module -e 'import {{createWebStore}} from \"./server/web-store.mjs\";import fs from \"node:fs\";const store=createWebStore();const old=await store.get(\"settings\",\"current\");if(old.privacyText.startsWith(\"请在正式开放前\"))await store.put(\"settings\",{{...old,privacyText:JSON.parse(fs.readFileSync(\"/tmp/waiqi-privacy.json\",\"utf8\"))}});await store.close();'")
    service = """[Unit]
Description=Waiqi workplace companion
After=network.target postgresql.service
Requires=postgresql.service
RequiresMountsFor=/srv/waiqi-data
[Service]
User=waiqi
Group=waiqi
WorkingDirectory=/opt/waiqiEnglish/current
EnvironmentFile=/etc/waiqiEnglish.env
ExecStart=/usr/local/bin/node server/web-index.mjs
Restart=on-failure
RestartSec=3
TimeoutStopSec=40
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/srv/waiqi-data
[Install]
WantedBy=multi-user.target
"""
    write("/etc/systemd/system/waiqiEnglish.service", service, 0o644)
    nginx = """server {
 listen 80 default_server;
 listen [::]:80 default_server;
 server_name DOMAIN;
 client_max_body_size 1m;
 add_header X-Content-Type-Options nosniff always;
 add_header Referrer-Policy same-origin always;
 add_header X-Frame-Options DENY always;
 location /.well-known/acme-challenge/ { root /var/www/waiqi-acme; }
 location / {
  proxy_pass http://127.0.0.1:8838;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For $remote_addr;
  proxy_read_timeout 310s;
  proxy_buffering off;
 }
}
""".replace("DOMAIN", DOMAIN).replace("SERVERIP", HOST)
    write("/etc/nginx/sites-available/waiqiEnglish", nginx, 0o644)
    run(f"set -eu; ln -sfn {shlex.quote(remote)} /opt/waiqiEnglish/current; systemctl daemon-reload; systemctl enable --now waiqiEnglish; systemctl restart waiqiEnglish; if test -e /etc/nginx/sites-enabled/default; then mv /etc/nginx/sites-enabled/default /etc/nginx/sites-available/default.disabled-waiqi; fi")
    run("install -d -m 755 /var/www/waiqi-acme/.well-known/acme-challenge && ln -sfn /etc/nginx/sites-available/waiqiEnglish /etc/nginx/sites-enabled/waiqiEnglish && nginx -t && systemctl reload nginx")
    run(f"certbot --nginx --non-interactive --agree-tos --register-unsafely-without-email --redirect -d {shlex.quote(DOMAIN)}", timeout=180)
    # Keep direct IP requests on the same canonical HTTPS origin used by authentication.
    write("/etc/nginx/conf.d/waiqi-ip.conf", f"server {{ listen 80; server_name {HOST}; return 302 https://{DOMAIN}$request_uri; }}\n", 0o644)
    # Certbot's original HTTP server may list the IP too; remove it there to avoid duplicates.
    run(f"sed -i 's/server_name {DOMAIN} {HOST};/server_name {DOMAIN};/' /etc/nginx/sites-available/waiqiEnglish && nginx -t && systemctl reload nginx")
    backup = """#!/bin/sh
set -eu
umask 077
file=/srv/waiqi-data/backups/waiqi-$(date -u +%Y%m%d-%H%M%S).sql.gz
runuser -u postgres -- pg_dump waiqi | gzip > "$file.tmp"
gzip -t "$file.tmp"
mv "$file.tmp" "$file"
find /srv/waiqi-data/backups -maxdepth 1 -type f -name 'waiqi-*.sql.gz' -mtime +14 -delete
"""
    # pipefail ensures a failed pg_dump never produces an apparently successful backup.
    backup = backup.replace("#!/bin/sh\nset -eu", "#!/bin/bash\nset -euo pipefail")
    write("/usr/local/sbin/waiqi-backup", backup, 0o700)
    write("/etc/cron.d/waiqi-backup", "17 19 * * * root /usr/local/sbin/waiqi-backup\n", 0o644)
    run("/usr/local/sbin/waiqi-backup && systemctl is-active waiqiEnglish && curl --fail --silent http://127.0.0.1:8838/api/health && echo")
    with client.open_sftp() as sftp:
        env = sftp.file("/etc/waiqiEnglish.env").read().decode()
    access = dict(line.split("=", 1) for line in env.splitlines() if "=" in line)
    (ROOT / "deploy").mkdir(exist_ok=True)
    (ROOT / "deploy" / "server-access.txt").write_text(f"网站：https://{DOMAIN}\n后台：https://{DOMAIN}/admin\n管理员：admin\n后台密码：{access['ADMIN_PASSWORD']}\n", encoding="utf-8")
    run("rm -f /tmp/waiqi-bootstrap.py /tmp/waiqi-privacy.json /tmp/waiqi-release.tar.gz")
    print(f"DEPLOYED https://{DOMAIN}; admin credentials saved to ignored deploy/server-access.txt", flush=True)
finally:
    try:
        client.exec_command("rm -f /tmp/waiqi-bootstrap.py /tmp/waiqi-privacy.json /tmp/waiqi-release.tar.gz")
    finally:
        client.close()
