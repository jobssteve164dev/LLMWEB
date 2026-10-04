import json
import subprocess
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[3]


def test_production_services_restart_after_the_docker_daemon_recovers() -> None:
    result = subprocess.run(
        ["docker", "compose", "-f", "compose.yaml", "config", "--format", "json"],
        cwd=PROJECT_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    services = json.loads(result.stdout)["services"]

    assert {
        service_name: service.get("restart")
        for service_name, service in services.items()
    } == {
        "control-plane": "unless-stopped",
        "web": "unless-stopped",
    }
