import getpass
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import argparse
import time
from pathlib import Path

parser = argparse.ArgumentParser(description="在 Linux systemd 采集服务启用 OpenAI 赛前推荐")
parser.add_argument("--app", type=Path, default=Path.cwd())
parser.add_argument("--worker", type=Path, help=argparse.SUPPRESS)
parser.add_argument("--socket", type=Path, help="通过指定的本机 Unix 套接字连接 OpenAI")
parser.add_argument("--ai-module", type=Path, help=argparse.SUPPRESS)
args = parser.parse_args()
app = args.app.resolve()
os.chdir(app)
os.umask(0o077)
env_file = app / ".env.local"
if not env_file.is_file() or not (app / "server/prematch-ai.mjs").is_file():
    sys.exit("未找到现有采集器及其 .env.local。")
unit = "rate90-collector.service"
if subprocess.run(["systemctl", "--user", "is-active", "--quiet", unit]).returncode:
    sys.exit("当前 Linux 用户没有正在运行的 rate90-collector.service。")
pid = subprocess.check_output(["systemctl", "--user", "show", "-p", "MainPID", "--value", unit], text=True).strip()
node = os.readlink("/proc/" + pid + "/exe")
if Path(node).name != "node":
    sys.exit("采集服务的运行进程不是 Node.js。")
active_module = app / "server/prematch-ai.mjs"
source_module = args.ai_module.resolve() if args.ai_module else active_module
candidate_code = source_module.read_bytes()
previous_code = active_module.read_bytes()
if args.ai_module and previous_code != candidate_code and hashlib.sha256(previous_code).hexdigest() != "848fa03d545d15b0cd4a42d7a4e13a7cfc248a8d584863f8761424f24c4a6694":
    sys.exit("服务器已有不同版本的 AI 模块，已保留。")
socket_path = str(args.socket.resolve()) if args.socket else ""
if args.socket and (not args.socket.is_socket() or not re.fullmatch(r"[\w./-]+", socket_path)):
    sys.exit("OpenAI 网络套接字路径无效。")
network_env = {}
network_names = {"PATH", "HOME", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
                 "NODE_USE_ENV_PROXY", "NODE_OPTIONS", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR"}
for field in Path("/proc", pid, "environ").read_bytes().split(b"\0"):
    name, sep, value = field.partition(b"=")
    if sep and os.fsdecode(name).upper() in network_names:
        network_env[os.fsdecode(name)] = os.fsdecode(value)
network_env["RATE90_PROBE_MODULE"] = source_module.as_uri()
network_env["RATE90_OPENAI_SOCKET"] = socket_path
diagnostics = """
const {openaiRequest, aiSettings, selectGames} = await import(process.env.RATE90_PROBE_MODULE);
const request = (url, options) => openaiRequest(url, options, process.env.RATE90_OPENAI_SOCKET);
const symbol = value => /^[A-Za-z0-9_.-]{1,80}$/.test(value ?? '') ? value : '';
function report(error) {
  const cause = error.cause ?? error;
  const codes = [cause.code, ...(cause.errors ?? []).map(e => e.code), error.name]
    .map(symbol).filter(Boolean);
  console.error('OpenAI 请求失败', [...new Set(codes)].join(' '));
}
async function httpError(response) {
  const body = await response.clone().json().catch(() => ({}));
  console.error('OpenAI HTTP', response.status, symbol(body.error?.code), symbol(body.error?.param),
                'request-id', symbol(response.headers.get('x-request-id')));
}
"""
network_probe = diagnostics + """
try {
  const r = await request('https://api.openai.com/v1/models', {redirect:'error', signal:AbortSignal.timeout(17000)});
  if (r.status !== 401 && !r.ok) { await httpError(r); process.exitCode = 1; }
  else console.log('OpenAI 官方接口已连接（HTTP ' + r.status + '）。');
} catch (e) { report(e); process.exitCode = 1; }
"""
def probe_node(script, env):
    return subprocess.run([node, "--input-type=module", "-e", script], env=env).returncode == 0

print("检查采集服务到 api.openai.com:443 的连接（无需密钥）…", flush=True)
if not probe_node(network_probe, network_env):
    sys.exit("采集服务未通过 OpenAI 连通测试。ENOTFOUND 或 EAI_AGAIN 表示 DNS 异常，ETIMEDOUT 表示连接超时。")
key = getpass.getpass("在 Linux 输入 OpenAI API Key（输入时隐藏）: ").strip()
if not re.fullmatch(r"[A-Za-z0-9_.-]+", key):
    sys.exit("密钥为空或含无效字符。")
url = "https://api.openai.com/v1"
updates = {"RATE90_AI_KEY":key, "RATE90_AI_BASE_URL":url, "RATE90_OPENAI_SOCKET":socket_path}
probe = diagnostics + """
const cfg = aiSettings();
if (cfg.url.href !== 'https://api.openai.com/v1/responses' || cfg.model !== 'gpt-6.2-sol') process.exit(2);
try {
  await selectGames(cfg, {games:[], teams:{}}, async (url, options) => {
    const r = await request(url, options);
    if (!r.ok) await httpError(r);
    else {
      const body = await r.clone().json();
      console.log('Responses API HTTP', r.status, symbol(body.status), symbol(body.incomplete_details?.reason));
    }
    return r;
  });
} catch (e) {
  report(e);
  if (e instanceof SyntaxError || /^AI 推荐/.test(e.message)) console.error('返回内容未通过赛前推荐 JSON 校验。');
  process.exit(1);
}
"""
print("正在向 OpenAI 验证模型访问权限…", flush=True)
if not probe_node(probe, {**network_env, **updates}):
    sys.exit("模型验证失败，采集配置尚未写入。")
if candidate_code != previous_code:
    with tempfile.NamedTemporaryFile(dir=active_module.parent, suffix=".mjs", delete=False) as out:
        staged = Path(out.name)
        out.write(candidate_code)
    try:
        subprocess.run([node, "--check", str(staged)], check=True)
        if active_module.read_bytes() != previous_code:
            sys.exit("Linux 的 AI 模块刚刚有更新，请重新运行。")
        os.replace(staged, active_module)
    finally:
        staged.unlink(missing_ok=True)
worker = app / "server/prematch-worker.mjs"
wanted = "243356003d0dd3abbced9495a7c3f0e4bfd34abd0ac98b2e094f62052714d5db"
installed = hashlib.sha256(worker.read_bytes()).hexdigest()
if args.worker and installed == "3ee010f7597980485ba52bfd335a42a41ae247f290577f4bd9d8eb5096df99f5":
    code = args.worker.read_bytes()
    if hashlib.sha256(code).hexdigest() != wanted:
        sys.exit("v0.2.0 采集模块校验失败。")
    with tempfile.NamedTemporaryFile(dir=worker.parent, suffix=".mjs", delete=False) as f:
        candidate = Path(f.name)
        f.write(code)
    try:
        subprocess.run([node, "--check", str(candidate)], check=True)
        if hashlib.sha256(worker.read_bytes()).hexdigest() != installed:
            sys.exit("采集模块刚刚有更新，请重新运行。")
        os.replace(candidate, worker)
    finally:
        candidate.unlink(missing_ok=True)
elif args.worker and installed != wanted:
    print("检测到不同版本的采集模块，沿用服务器已有版本。")
original = env_file.read_text()
keep = [line for line in original.splitlines(keepends=True)
        if not re.match(r'^\s*(?:export\s+)?(?:RATE90_AI_KEY|RATE90_AI_BASE_URL|RATE90_OPENAI_SOCKET)\s*=', line)]
with tempfile.NamedTemporaryFile(mode="w", dir=app, delete=False) as out:
    temporary = Path(out.name)
    try:
        out.write("".join(keep).rstrip("\r\n") + "\n")
        out.writelines(k + "=" + v + "\n" for k, v in updates.items())
        out.flush()
        os.fsync(out.fileno())
        if env_file.read_text() != original:
            sys.exit("配置文件在验证期间有其他更新，请重新运行。")
        os.replace(temporary, env_file)
    finally:
        temporary.unlink(missing_ok=True)
started = int(time.time() * 1000)
subprocess.run(["systemctl", "--user", "restart", unit], check=True)
print("RATE90_OPENAI_OK  gpt-6.2-sol 已验证，采集服务已重启。正在等待赛前快照…", flush=True)
data = app / "public/ui/data"
prefix = "document.currentScript.rate90Data = "
def asset(stem):
    s = (data / (stem + ".js")).read_text().strip()
    if not s.startswith(prefix) or not s.endswith(";"):
        raise ValueError("快照格式异常")
    return json.loads(s[len(prefix):-1])
for _ in range(90):
    try:
        name = asset("collected-index").get("prematchFile", "")
        if re.fullmatch(r"prematch-[a-f0-9]{20}", name):
            feed = asset(name)
            rows = [r for r in feed.get("picks", {}).values() if r.get("at",0) >= started]
            if feed.get("model") == "gpt-6.2-sol" and rows:
                matches = {p["id"] for r in rows for p in r["items"]}
                print("RATE90_AI_SNAPSHOT_OK  新评估 %d 组，推荐 %d 场。" % (len(rows), len(matches)))
                sys.exit(0)
    except (OSError, ValueError, KeyError):
        pass
    time.sleep(5)
print("模型验证成功，暂未读到本轮新评估。查看采集进度：journalctl --user -u rate90-collector -n 30")
