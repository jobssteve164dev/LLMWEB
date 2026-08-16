import base64
import hashlib
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from llmweb_control.database import Base, engine
from llmweb_control.main import DEFAULT_WORKSPACE_ID, app
from llmweb_control.models import ApiRequestReceipt, Dataset, Experiment, Job, Runner, Workspace
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


def ready_capabilities() -> dict[str, object]:
    return {
        "ready": True,
        "backend": "docker_cpu",
        "cpu_cores": 4,
        "memory_total_mb": 8192,
        "disk_free_mb": 30 * 1024,
        "training_environment_version": "0.2.3",
    }


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
        assert pairing["command"].startswith("curl -fsSL https://llmweb.szlk.ai/install-runner.sh | sudo bash -s --")
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

        upgrade_pairing = client.post("/v1/runners/pairing", headers=WEB_HEADERS).json()
        upgrade_response = client.post(
            "/v1/runners/upgrade-authorization",
            headers=runner_headers,
            json={"code": upgrade_pairing["code"]},
        )
        assert upgrade_response.status_code == 200
        assert upgrade_response.json() == {"authorized": True}
        assert client.post(
            "/v1/runners/upgrade-authorization",
            headers=runner_headers,
            json={"code": upgrade_pairing["code"]},
        ).status_code == 400

        foreign_pairing = client.post(
            "/v1/runners/pairing",
            headers=web_headers(user_id="passport-user-2", email="other@example.com"),
        ).json()
        foreign_upgrade = client.post(
            "/v1/runners/upgrade-authorization",
            headers=runner_headers,
            json={"code": foreign_pairing["code"]},
        )
        assert foreign_upgrade.status_code == 409
        assert foreign_upgrade.json()["detail"] == "这台电脑属于另一个训练工作区"

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


def test_cpu_runner_uses_the_fixed_starter_training_flow() -> None:
    reset_database()
    with TestClient(app) as client:
        project_id = client.post(
            "/v1/projects",
            headers=WEB_HEADERS,
            json={"name": "第一次训练", "goal": "学会文本续写", "success_criteria": "测试损失下降"},
        ).json()["id"]
        pairing = client.post("/v1/runners/pairing", headers=WEB_HEADERS).json()
        pair_response = client.post(
            "/v1/runners/pair",
            json={
                "code": pairing["code"],
                "name": "4 核 8G 普通电脑",
                "capabilities": {
                    "ready": True, "backend": "docker_cpu", "cpu_cores": 4,
                    "memory_total_mb": 8192, "disk_free_mb": 10 * 1024,
                    "training_environment_version": "0.2.1",
                },
            },
        )
        runner_id = pair_response.json()["runner_id"]
        runner_headers = {"Authorization": f"Bearer {pair_response.json()['device_token']}"}
        dataset_response = client.post(
            "/v1/datasets",
            headers=WEB_HEADERS,
            json={
                "project_id": project_id, "runner_id": runner_id, "name": "入门练习数据",
                "source_type": "starter", "source_ref": "tiny-shakespeare", "format": "txt",
            },
        )
        assert dataset_response.status_code == 201, dataset_response.text
        dataset_id = dataset_response.json()["id"]
        inspect_lease = client.post("/v1/runners/jobs/lease", headers=runner_headers).json()
        assert inspect_lease["payload"]["source_type"] == "starter"
        complete_job(client, runner_headers, inspect_lease, {"version_hash": "sha256:starter", "statistics": {"characters": 1000}})

        experiment_payload = {
            "project_id": project_id, "runner_id": runner_id, "dataset_id": dataset_id,
            "name": "入门训练", "model_id": "karpathy/nanoGPT", "method": "starter",
            "export_formats": ["model"], "license_confirmed": True,
        }
        insufficient_disk = client.post("/v1/experiments", headers=WEB_HEADERS, json=experiment_payload)
        assert insufficient_disk.status_code == 409
        assert "不足 20GB" in insufficient_disk.json()["detail"]
        client.post(
            "/v1/runners/heartbeat", headers=runner_headers,
            json={"capabilities": {
                "ready": True, "backend": "docker_cpu", "disk_free_mb": 80 * 1024,
                "training_environment_version": "0.2.1",
            }},
        )
        experiment_response = client.post(
            "/v1/experiments",
            headers=WEB_HEADERS,
            json=experiment_payload,
        )
        assert experiment_response.status_code == 201, experiment_response.text
        baseline = client.post("/v1/runners/jobs/lease", headers=runner_headers).json()
        assert baseline["payload"]["runtime"] == {"engine": "nanogpt", "image": "llmweb/runtime-cpu:0.2.1"}
        assert baseline["payload"]["environment"] == {"version": "0.2.1", "backend": "linux-amd64-cpu"}
        assert baseline["payload"]["training"]["iterations"] == 500


def test_standard_user_api_submission_owns_the_durable_receipt() -> None:
    reset_database()
    with TestClient(app) as client:
        project_id = client.post("/v1/projects", headers=WEB_HEADERS, json={
            "name": "标准 API 可靠受理", "goal": "完成训练", "success_criteria": "导出模型",
        }).json()["id"]
        pairing = client.post("/v1/runners/pairing", headers=WEB_HEADERS).json()
        runner = client.post("/v1/runners/pair", json={
            "code": pairing["code"], "name": "标准 API 节点", "capabilities": ready_capabilities(),
        }).json()
        connection = client.post("/v1/api-connections", headers=WEB_HEADERS, json={
            "name": "标准 API", "purpose": "验证可靠受理", "capabilities": ["project:write", "training:write"],
        }).json()["connection"]
        headers = {**WEB_HEADERS, "X-LLMWEB-API-Connection-ID": connection["id"], "X-Request-ID": "standard-dataset-request"}
        body = {
            "project_id": project_id, "runner_id": runner["runner_id"], "name": "莎士比亚文本练习集",
            "source_type": "starter", "source_ref": "tiny-shakespeare", "format": "txt",
            "train_percent": 80, "validation_percent": 10, "test_percent": 10, "preview_allowed": True,
        }
        first = client.post("/v1/datasets", headers=headers, json=body)
        assert first.status_code == 201, first.text
        replay = client.post("/v1/datasets", headers=headers, json=body)
        assert replay.status_code == 201, replay.text
        assert replay.json() == first.json()
        conflict = client.post("/v1/datasets", headers=headers, json={**body, "name": "不同请求"})
        assert conflict.status_code == 409, conflict.text
        experiment_headers = {**headers, "X-Request-ID": "standard-training-request"}
        experiment_body = {
            "project_id": project_id, "runner_id": runner["runner_id"], "dataset_id": first.json()["id"],
            "name": "标准 API 训练", "model_id": "karpathy/nanoGPT", "method": "starter", "epochs": 1,
            "learning_rate": 0.001, "max_length": 128, "batch_size": 12, "gradient_accumulation": 1,
            "export_formats": ["model"], "evaluation_preview_allowed": True,
            "output_destination": "local", "license_confirmed": True,
        }
        rejected_before_commit = client.post("/v1/experiments", headers=experiment_headers, json=experiment_body)
        assert rejected_before_commit.status_code == 409
        with Session(engine) as db:
            assert db.query(Dataset).count() == 1
            assert db.query(Experiment).count() == 0
            assert db.query(Job).count() == 1
            assert db.query(ApiRequestReceipt).count() == 1
            dataset = db.query(Dataset).one()
            dataset.status = "ready"
            dataset.version_hash = "sha256:standard-api"
            db.commit()

        accepted = client.post("/v1/experiments", headers=experiment_headers, json=experiment_body)
        assert accepted.status_code == 201, accepted.text
        assert client.post("/v1/experiments", headers=experiment_headers, json=experiment_body).json() == accepted.json()
        run = client.get(f"/v1/experiments/{accepted.json()['id']}", headers=headers)
        assert run.status_code == 200
        assert run.json()["training_run"]["id"] == accepted.json()["id"]
        with Session(engine) as db:
            assert db.query(Experiment).count() == 1
            assert db.query(Job).count() == 5
            assert db.query(ApiRequestReceipt).count() == 2

        wrong_account = client.post("/v1/datasets", headers={
            **web_headers(user_id="passport-user-2", email="other@example.com"),
            "X-LLMWEB-API-Connection-ID": connection["id"], "X-Request-ID": "wrong-account-request",
        }, json=body)
        assert wrong_account.status_code == 404
        client.post(f"/v1/api-connections/{connection['id']}/revoke", headers=WEB_HEADERS, json={})
        revoked = client.post("/v1/datasets", headers={**headers, "X-Request-ID": "revoked-request"}, json=body)
        assert revoked.status_code == 401


def test_user_api_revokes_one_exact_idle_runner_and_blocks_its_device_identity() -> None:
    reset_database()
    with TestClient(app) as client:
        pairing = client.post("/v1/runners/pairing", headers=WEB_HEADERS).json()
        paired = client.post(
            "/v1/runners/pair",
            json={"code": pairing["code"], "name": "旧训练节点", "capabilities": ready_capabilities()},
        )
        assert paired.status_code == 201, paired.text
        runner = paired.json()
        runner_headers = {"Authorization": f"Bearer {runner['device_token']}"}

        created = client.post("/v1/api-connections", headers=WEB_HEADERS, json={
            "name": "算力治理连接",
            "purpose": "精确撤销旧训练节点",
            "capabilities": ["workspace:read", "runner:pair"],
        })
        assert created.status_code == 201, created.text
        revoked = client.post(f"/v1/runners/{runner['runner_id']}/revoke", headers=WEB_HEADERS, json={
            "confirm_runner_id": runner["runner_id"],
        })
        assert revoked.status_code == 200, revoked.text
        assert revoked.json() == {
            "runner_id": runner["runner_id"], "revoked": True, "already_revoked": False,
        }
        assert client.post(
            "/v1/runners/heartbeat", headers=runner_headers,
            json={"capabilities": ready_capabilities(), "active_job_id": None},
        ).status_code == 401
        pool_response = client.get("/v1/training-pool", headers=WEB_HEADERS)
        assert pool_response.status_code == 200, pool_response.text
        pool = pool_response.json()
        assert pool["training_pool"] == []


def test_user_api_refuses_runner_revocation_with_wrong_confirmation_or_active_work() -> None:
    reset_database()
    with TestClient(app) as client:
        pairing = client.post("/v1/runners/pairing", headers=WEB_HEADERS).json()
        runner = client.post(
            "/v1/runners/pair",
            json={"code": pairing["code"], "name": "忙碌训练节点", "capabilities": ready_capabilities()},
        ).json()
        wrong = client.post(f"/v1/runners/{runner['runner_id']}/revoke", headers=WEB_HEADERS, json={
            "confirm_runner_id": "run_wrong",
        })
        assert wrong.status_code == 400

        with Session(engine) as db:
            db.add(Job(
                workspace_id=DEFAULT_WORKSPACE_ID,
                runner_id=runner["runner_id"],
                kind="train",
                payload={},
                status="running",
            ))
            db.commit()
        busy = client.post(f"/v1/runners/{runner['runner_id']}/revoke", headers=WEB_HEADERS, json={
            "confirm_runner_id": runner["runner_id"],
        })
        assert busy.status_code == 409


def test_user_api_compose_has_no_bridge_credentials() -> None:
    compose = (Path(__file__).parents[3] / "compose.yaml").read_text()
    assert "CLOUDMCP_BRIDGE_CLIENT_ID:" not in compose
    assert "CLOUDMCP_BRIDGE_CLIENT_SECRET:" not in compose
    assert "LLMWEB_CLOUDMCP_BRIDGE_CLIENT" not in compose
    assert "LLMWEB_CLOUDMCP_OPERATOR_WORKSPACE_ID" not in compose
    assert "ws_cloudmcp_operator" not in compose


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


def test_control_plane_enforces_the_positive_catalog_quota_without_a_local_plan_matrix() -> None:
    reset_database()
    with TestClient(app) as client:
        catalog_headers = web_headers("passport-catalog-user", "catalog@example.com", 3)
        for index in range(3):
            response = client.post(
                "/v1/projects",
                headers=catalog_headers,
                json={"name": f"中央额度项目 {index + 1}", "goal": "目标", "success_criteria": "标准"},
            )
            assert response.status_code == 201, response.text
        assert client.post(
            "/v1/projects",
            headers=catalog_headers,
            json={"name": "超出中央额度", "goal": "目标", "success_criteria": "标准"},
        ).status_code == 409
        assert client.get("/v1/state", headers=web_headers(project_limit=0)).status_code == 401


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
