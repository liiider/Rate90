"""Prepare an OpenAI-only TLS relay on an existing, working Docker bridge."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time


def main(source_container):
    docker = ["docker"]
    if subprocess.run(docker + ["info"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
        subprocess.run(["sudo", "-v"], check=True)
        docker = ["sudo", "-n", "docker"]

    def inspect(kind, fmt, name):
        return subprocess.check_output(docker + [kind, "inspect", "--format", fmt, "--", name], text=True).strip()

    image = inspect("container", "{{.Image}}", source_container)
    mode = inspect("container", "{{.HostConfig.NetworkMode}}", source_container)
    network_owner = mode.removeprefix("container:") if mode.startswith("container:") else source_container
    networks = json.loads(inspect("container", "{{json .NetworkSettings.Networks}}", network_owner))
    runner = Path(__file__).with_name("openai-tcp.py")
    root = Path.home() / ".local/share/rate90-openai"
    os.umask(0o077)
    root.mkdir(parents=True, exist_ok=True)
    uid = f"{os.getuid()}:{os.getgid()}"
    sandbox = ["--pull=never", "--user", uid, "--read-only", "--cap-drop=ALL",
               "--security-opt=no-new-privileges", "--pids-limit=32", "--memory=96m"]
    for net in sorted(networks, key=lambda n: networks[n].get("GwPriority", 0), reverse=True):
        if inspect("network", "{{.Driver}} {{.Internal}}", net) != "bridge false":
            continue
        print("正在验证独立的 Rate90 容器能否通过现有 Docker 网络访问 OpenAI…", file=sys.stderr)
        probe = subprocess.run(docker + ["run", "--rm", *sandbox, "--network", net, "--entrypoint", "curl",
                               image, "-q", "--noproxy", "*", "-sS", "--connect-timeout", "6", "--max-time", "12",
                               "-o", "/dev/null", "-w", "%{http_code}", "https://api.openai.com/v1/models"],
                               text=True, stdout=subprocess.PIPE)
        if probe.returncode or probe.stdout != "401":
            continue
        identity = hashlib.sha256(runner.read_bytes() + str(root).encode() + net.encode() + image.encode()).hexdigest()[:12]
        name = "rate90-openai-" + identity
        work = root / identity
        sockdir = work / "socket"
        sockdir.mkdir(parents=True, exist_ok=True)
        sock = sockdir / "openai.sock"
        script = work / "relay.py"
        with tempfile.NamedTemporaryFile(dir=work, delete=False) as tmp:
            with runner.open("rb") as source:
                shutil.copyfileobj(source, tmp)
        os.replace(tmp.name, script)
        if subprocess.check_output(docker + ["ps", "-aq", "--filter", "name=^/" + name + "$"], text=True).strip():
            if inspect("container", '{{index .Config.Labels "rate90.openai.relay"}}', name) != identity:
                sys.exit("同名容器由其他部署管理。")
            subprocess.run(docker + ["start", name], stdout=subprocess.DEVNULL, check=True)
        else:
            subprocess.run(docker + ["run", "-d", *sandbox, "--network", net, "--restart=unless-stopped",
                           "--name", name, "--label", "rate90.openai.relay=" + identity,
                           "--mount", f"type=bind,src={sockdir},dst=/run/rate90",
                           "--mount", f"type=bind,src={script},dst=/rate90-relay.py,readonly",
                           "--entrypoint", "python3", image, "-I", "-B", "/rate90-relay.py"],
                           stdout=subprocess.DEVNULL, check=True)
        for _ in range(60):
            if sock.is_socket():
                print(sock)
                return
            time.sleep(.25)
        sys.exit("独立网络容器未能创建本机套接字。")
    sys.exit("独立 Rate90 容器未能在现有桥接网络收到 OpenAI 的 HTTP 401。采集配置尚未修改。")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("用法：python3 deploy/openai-network.py <已有容器名>")
    main(sys.argv[1])
