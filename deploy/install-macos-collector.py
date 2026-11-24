"""Install the local Rate90 collector as a per-user macOS LaunchAgent."""
import argparse
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
from tempfile import NamedTemporaryFile


ROOT = Path(__file__).resolve().parents[1]
LABEL = "com.rate90.collector"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--print", action="store_true", help="print the plist without installing")
    args = parser.parse_args()
    node = shutil.which("node")
    if not node:
        parser.exit(1, "找不到 Node.js，请先安装项目所需版本。\n")
    logs = Path.home() / "Library" / "Logs" / "Rate90"
    plist = plistlib.dumps({
        "Label": LABEL,
        "WorkingDirectory": str(ROOT),
        "ProgramArguments": [node, "--experimental-sqlite", "--env-file=.env.local",
                             "scripts/collect.mjs", "--watch"],
        "RunAtLoad": True,
        "KeepAlive": {"SuccessfulExit": False},
        "ThrottleInterval": 60,
        "StandardOutPath": str(logs / "collector.log"),
        "StandardErrorPath": str(logs / "collector-error.log"),
    })
    if args.print:
        sys.stdout.buffer.write(plist)
        return
    if sys.platform != "darwin":
        parser.exit(1, "此安装命令适用于 macOS。\n")
    # Match launchd's environment. The token must be available after login.
    env = dict(os.environ)
    env.pop("BSD_API_TOKEN", None)
    subprocess.run([node, "--experimental-sqlite", "--env-file=.env.local", "-e",
                    "require('node:sqlite'); if (!process.env.BSD_API_TOKEN) "
                    "throw new Error('请在项目根目录的 .env.local 中设置 BSD_API_TOKEN')"],
                   check=True, cwd=ROOT, env=env)
    target = Path.home() / "Library" / "LaunchAgents" / (LABEL + ".plist")
    domain = f"gui/{os.getuid()}"
    service = f"{domain}/{LABEL}"
    loaded = subprocess.run(["launchctl", "print", service],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    logs.mkdir(parents=True, exist_ok=True)
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists() or target.read_bytes() != plist:
        with NamedTemporaryFile(dir=target.parent, delete=False) as tmp:
            tmp.write(plist)
        Path(tmp.name).replace(target)
        if loaded:
            subprocess.run(["launchctl", "bootout", service], check=True)
            loaded = False
    if not loaded:
        subprocess.run(["launchctl", "bootstrap", domain, str(target)], check=True)
    print(f"本地采集服务已加载。日志目录：{logs}")


if __name__ == "__main__":
    main()
