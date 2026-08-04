import base64
import hashlib

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from llmweb_control.database import Base, engine
from llmweb_control.main import DEFAULT_WORKSPACE_ID, app
from llmweb_control.models import Dataset, Job, Runner, Workspace
from llmweb_control.security import digest_secret
from llmweb_control.settings import get_settings


def web_headers(user_id: str = "passport-user-1", email: str = "owner@example.com", project_limit: int = 2) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {get_settings().web_token}",
        "X-LLMWEB-User-ID": user_id,
        "X-LLMWEB-User-Email": base64.urlsafe_b64encode(email.encode()).decode().rstrip("="),
        "X-LLMWEB-User-Name": "",
        "X-LLMWEB-Project-Limit": str(project_limit),
    }


def workspace_id(user_id: str = "passport-user-1") -> str:
    return f"ws_{hashlib.sha256(user_id.encode()).hexdigest()[:40]}"


WEB_HEADERS = web_headers()


def reset_database() -> None:
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add(Workspace(id=DEFAULT_WORKSPACE_ID, name="我的工作区"))
        db.commit()


def complete_job(client: TestClient, runner_headers: dict[str, str], lease: dict, payload: dict | None = None) -> None:
    response = client.post(
        f"/v1/runners/jobs/{lease['job_id']}/events",
        headers=runner_headers,
        json={
            "lease_id": lease["lease_id"],
            "events": [
                {"event_id": f"{lease['job_id']}-accepted", "type": "accepted", "payload": {}},
                {"event_id": f"{lease['job_id']}-done", "type": "completed", "payload": payload or {}},
            ],
        },
    )
    assert response.status_code == 202, response.text


def test_complete_local_training_workflow() -> None:
    reset_database()
    with TestClient(app) as client:
        assert client.get("/v1/state").status_code == 401

        project_response = client.post(
            "/v1/projects",
            headers=WEB_HEADERS,
            json={"name": "客服模型", "goal": "回答产品问题", "success_criteria": "格式通过率高于基础模型"},
        )
        assert project_response.status_code == 201
        project_id = project_response.json()["id"]

        pairing = client.post("/v1/runners/pairing", headers=WEB_HEADERS).json()
        assert pairing["command"].startswith("curl -fsSL https://raw.githubusercontent.com/jobssteve164dev/LLMWEB/main/scripts/install-runner.sh | sudo bash -s --")
        assert f"--url {get_settings().public_url} --code {pairing['code']}" in pairing["command"]
        pair_response = client.post(
            "/v1/runners/pair",
            json={
                "code": pairing["code"],
                "name": "测试算力",
                "capabilities": {"ready": True, "gpus": [{"name": "Test GPU", "memory_total_mb": 24576}]},
            },
        )
        assert pair_response.status_code == 201
        runner_id = pair_response.json()["runner_id"]
        runner_headers = {"Authorization": f"Bearer {pair_response.json()['device_token']}"}

        dataset_response = client.post(
            "/v1/datasets",
            headers=WEB_HEADERS,
            json={
                "project_id": project_id,
                "runner_id": runner_id,
                "name": "客服问答",
                "source_ref": "support/train.jsonl",
                "format": "jsonl",
                "preview_allowed": True,
            },
        )
        assert dataset_response.status_code == 201, dataset_response.text
        dataset_id = dataset_response.json()["id"]
        inspect_lease = client.post("/v1/runners/jobs/lease", headers=runner_headers).json()
        assert inspect_lease["kind"] == "inspect"
        complete_job(
            client,
            runner_headers,
            inspect_lease,
            {
                "version_hash": "sha256:test",
                "statistics": {"rows": 120, "valid_rows": 118, "splits": {"train": 94, "validation": 12, "test": 12}},
                "preview": [{"instruction": "你好", "output": "您好"}],
            },
        )

        experiment_response = client.post(
            "/v1/experiments",
            headers=WEB_HEADERS,
            json={
                "project_id": project_id,
                "runner_id": runner_id,
                "dataset_id": dataset_id,
                "name": "第一次训练",
                "model_id": "Qwen/Qwen2.5-0.5B-Instruct",
                "license_confirmed": True,
                "export_formats": ["adapter", "huggingface", "gguf"],
            },
        )
        assert experiment_response.status_code == 201, experiment_response.text
        experiment_id = experiment_response.json()["id"]

        for expected_kind in ("baseline", "train", "evaluate", "export"):
            lease_response = client.post("/v1/runners/jobs/lease", headers=runner_headers)
            assert lease_response.status_code == 200, lease_response.text
            lease = lease_response.json()
            assert lease["kind"] == expected_kind
            if expected_kind in {"evaluate", "export"}:
                assert lease["payload"]["selected_checkpoint"] == "adapter/checkpoint-100"
            result = {}
            if expected_kind == "baseline":
                result = {"metrics": {"exact_match": 0.42, "format_pass_rate": 0.75}}
            elif expected_kind == "train":
                result = {
                    "checkpoints": [
                        {"reference": "adapter/checkpoint-100", "label": "训练进度 100", "recommended": True, "validation_loss": 0.83}
                    ]
                }
            elif expected_kind == "evaluate":
                result = {"metrics": {"exact_match": 0.64, "format_pass_rate": 0.92}}
            elif expected_kind == "export":
                result = {"artifacts": [{"format": "adapter", "reference": "experiments/test/adapter"}]}
            complete_job(client, runner_headers, lease, result)
            if expected_kind == "train":
                waiting_state = client.get("/v1/state", headers=WEB_HEADERS).json()
                waiting_experiment = next(item for item in waiting_state["experiments"] if item["id"] == experiment_id)
                assert waiting_experiment["status"] == "awaiting_selection"
                select_response = client.post(
                    f"/v1/experiments/{experiment_id}/select-checkpoint",
                    headers=WEB_HEADERS,
                    json={"checkpoint_ref": "adapter/checkpoint-100"},
                )
                assert select_response.status_code == 200, select_response.text

        state = client.get("/v1/state", headers=WEB_HEADERS).json()
        assert state["account"]["email"] == "owner@example.com"
        assert state["project_quota"] == {"used": 1, "limit": 2, "remaining": 1}
        assert state["current_project_id"] == project_id
        experiment = next(item for item in state["experiments"] if item["id"] == experiment_id)
        assert len(experiment["model"]["revision"]) == 40
        assert experiment["status"] == "completed"
        assert experiment["baseline_metrics"]["exact_match"] == 0.42
        assert experiment["tuned_metrics"]["exact_match"] == 0.64
        assert experiment["artifacts"][0]["format"] == "adapter"
        assert experiment["selected_checkpoint"] == "adapter/checkpoint-100"
        dataset = next(item for item in state["datasets"] if item["id"] == dataset_id)
        assert dataset["status"] == "ready"
        assert dataset["statistics"]["valid_rows"] == 118


def test_resume_control_reaches_paused_job() -> None:
    reset_database()
    token = "runner-test-token"
    with Session(engine) as db:
        runner = Runner(
            workspace_id=workspace_id(),
            name="暂停测试算力",
            token_hash=digest_secret(token),
            capabilities={"ready": True},
            status="busy",
        )
        db.add(runner)
        db.flush()
        job = Job(
            workspace_id=workspace_id(),
            runner_id=runner.id,
            kind="train",
            payload={},
            status="paused",
            desired_state="paused",
            lease_id="lease_resume",
        )
        db.add(job)
        db.commit()
        job_id = job.id

    with TestClient(app) as client:
        response = client.post(
            f"/v1/jobs/{job_id}/control",
            headers=WEB_HEADERS,
            json={"action": "resume"},
        )
        assert response.status_code == 200
        heartbeat = client.post(
            "/v1/runners/heartbeat",
            headers={"Authorization": f"Bearer {token}"},
            json={"capabilities": {"ready": True}, "active_job_id": job_id},
        )
        assert heartbeat.json()["controls"] == [{"job_id": job_id, "action": "running"}]
        progress = client.post(
            f"/v1/runners/jobs/{job_id}/events",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "lease_id": "lease_resume",
                "events": [{"event_id": "resume-progress", "type": "progress", "payload": {"percent": 40}}],
            },
        )
        assert progress.status_code == 202
        with Session(engine) as db:
            assert db.get(Job, job_id).status == "running"


def test_apple_silicon_uses_lora_instead_of_cuda_qlora() -> None:
    reset_database()
    with TestClient(app) as client:
        project_id = client.post(
            "/v1/projects",
            headers=WEB_HEADERS,
            json={"name": "M1 Max 训练", "goal": "本地微调", "success_criteria": "完成同集复测"},
        ).json()["id"]
        with Session(engine) as db:
            runner = Runner(
                workspace_id=workspace_id(),
                name="MacBook Pro M1 Max",
                token_hash=digest_secret("mps-runner-token"),
                capabilities={"ready": True, "backend": "native_mps", "mps_available": True},
            )
            db.add(runner)
            db.flush()
            dataset = Dataset(
                workspace_id=workspace_id(), project_id=project_id, runner_id=runner.id,
                name="本地数据", source_ref="data/train.jsonl", format="jsonl", status="ready",
                mapping={"instruction": "instruction", "input": "input", "output": "output"},
                split={"train": 80, "validation": 10, "test": 10},
            )
            db.add(dataset)
            db.commit()
            runner_id = runner.id
            dataset_id = dataset.id

        payload = {
            "project_id": project_id,
            "runner_id": runner_id,
            "dataset_id": dataset_id,
            "name": "MPS LoRA",
            "model_id": "Qwen/Qwen2.5-0.5B-Instruct",
            "license_confirmed": True,
        }
        rejected = client.post("/v1/experiments", headers=WEB_HEADERS, json={**payload, "method": "qlora"})
        assert rejected.status_code == 400
        assert "Apple Silicon" in rejected.json()["detail"]
        accepted = client.post("/v1/experiments", headers=WEB_HEADERS, json={**payload, "method": "lora"})
        assert accepted.status_code == 201, accepted.text


def test_project_limits_and_user_isolation() -> None:
    reset_database()
    with TestClient(app) as client:
        first_project = client.post(
            "/v1/projects",
            headers=WEB_HEADERS,
            json={"name": "项目一", "goal": "目标一", "success_criteria": "标准一"},
        )
        second_project = client.post(
            "/v1/projects",
            headers=WEB_HEADERS,
            json={"name": "项目二", "goal": "目标二", "success_criteria": "标准二"},
        )
        blocked = client.post(
            "/v1/projects",
            headers=WEB_HEADERS,
            json={"name": "项目三", "goal": "目标三", "success_criteria": "标准三"},
        )
        assert first_project.status_code == 201
        assert second_project.status_code == 201
        assert blocked.status_code == 409

        paid_headers = web_headers("passport-paid-user", "paid@example.com", 10)
        for index in range(10):
            response = client.post(
                "/v1/projects",
                headers=paid_headers,
                json={"name": f"付费项目 {index + 1}", "goal": "目标", "success_criteria": "标准"},
            )
            assert response.status_code == 201, response.text
        assert client.post(
            "/v1/projects",
            headers=paid_headers,
            json={"name": "第十一个项目", "goal": "目标", "success_criteria": "标准"},
        ).status_code == 409

        other_headers = web_headers("passport-user-2", "other@example.com", 2)
        isolated_state = client.get("/v1/state", headers=other_headers).json()
        assert isolated_state["projects"] == []
        assert isolated_state["project_quota"]["used"] == 0
        assert client.get(
            f"/v1/state?project_id={first_project.json()['id']}",
            headers=other_headers,
        ).status_code == 404


def test_state_only_returns_selected_project_resources() -> None:
    reset_database()
    with TestClient(app) as client:
        project_ids = []
        for name in ("项目甲", "项目乙"):
            response = client.post(
                "/v1/projects",
                headers=WEB_HEADERS,
                json={"name": name, "goal": "目标", "success_criteria": "标准"},
            )
            project_ids.append(response.json()["id"])

        with Session(engine) as db:
            runner = Runner(
                workspace_id=workspace_id(),
                name="共享算力",
                token_hash=digest_secret("shared-runner-token"),
                capabilities={"ready": True},
            )
            db.add(runner)
            db.flush()
            for index, project_id in enumerate(project_ids):
                dataset = Dataset(
                    workspace_id=workspace_id(),
                    project_id=project_id,
                    runner_id=runner.id,
                    name=f"数据 {index}",
                    source_ref=f"data/{index}.jsonl",
                    format="jsonl",
                    mapping={"instruction": "instruction", "input": "input", "output": "output"},
                    split={"train": 80, "validation": 10, "test": 10},
                )
                db.add(dataset)
                db.flush()
                db.add(Job(
                    workspace_id=workspace_id(),
                    runner_id=runner.id,
                    dataset_id=dataset.id,
                    kind="inspect",
                    payload={},
                ))
            db.commit()

        first_state = client.get(f"/v1/state?project_id={project_ids[0]}", headers=WEB_HEADERS).json()
        second_state = client.get(f"/v1/state?project_id={project_ids[1]}", headers=WEB_HEADERS).json()
        assert {item["project_id"] for item in first_state["datasets"]} == {project_ids[0]}
        assert {item["project_id"] for item in second_state["datasets"]} == {project_ids[1]}
        assert len(first_state["jobs"]) == 1
        assert len(second_state["jobs"]) == 1
        assert first_state["jobs"][0]["dataset_id"] != second_state["jobs"][0]["dataset_id"]
