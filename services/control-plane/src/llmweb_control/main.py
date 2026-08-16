from contextlib import asynccontextmanager
from datetime import timedelta, timezone
import hashlib
import json
import secrets
import shlex
from typing import Annotated, Any

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .database import Base, engine, get_db
from .models import ApiAuditEvent, ApiConnection, ApiRequestReceipt, Dataset, Experiment, Job, JobEvent, PairingCode, Project, Runner, Workspace, new_id, utc_now
from .schemas import ApiAuditCreate, ApiConnectionCreate, CheckpointSelect, DatasetCreate, EventBatch, ExperimentCreate, HeartbeatRequest, JobControl, PairRequest, ProjectCreate, RunnerUpgradeAuthorization
from .security import WebIdentity, digest_secret, require_internal_web, require_runner, require_web, resolve_api_connection
from .settings import get_settings

Db = Annotated[Session, Depends(get_db)]
WebAuth = Annotated[WebIdentity, Depends(require_web)]
DEFAULT_WORKSPACE_ID = "ws_default"
APPROVED_MODELS = {
    "Qwen/Qwen2.5-0.5B-Instruct": "7ae557604adf67be50417f59c2c2f167def9a775",
    "Qwen/Qwen2.5-1.5B-Instruct": "989aa7980e4cf806f80c7fef2b1adb7bc71aa306",
    "Qwen/Qwen2.5-3B-Instruct": "aa8e72537993ba99e69dfaafa59ed015b17504d1",
    "karpathy/nanoGPT": "3adf61e154c3fe3fca428ad6bc3818b27a3b8291",
}
USER_API_TOOL_CATALOG = [
    {
        "name": "list_llmweb_training_pool",
        "description": "查看 LLMWEB 训练池、项目和最近训练状态。",
        "inputSchema": {"type": "object", "additionalProperties": False, "properties": {"project_id": {"type": "string"}}},
    },
    {
        "name": "create_llmweb_starter_project",
        "description": "建立一个由 LLMWEB 全程引导的入门模型训练项目。",
        "inputSchema": {
            "type": "object", "additionalProperties": False,
            "properties": {
                "name": {"type": "string", "minLength": 1, "maxLength": 120},
                "goal": {"type": "string", "minLength": 1, "maxLength": 2000},
                "success_criteria": {"type": "string", "minLength": 1, "maxLength": 2000},
            },
        },
    },
    {
        "name": "create_llmweb_runner_pairing",
        "description": "生成一次性训练池接入凭证，供 GitOps 把指定节点接入 LLMWEB。",
        "inputSchema": {"type": "object", "additionalProperties": False, "properties": {}},
    },
    {
        "name": "revoke_llmweb_runner",
        "description": "精确撤销当前账户的一台空闲训练算力，使旧设备身份立即失去心跳和领取任务权限。",
        "inputSchema": {
            "type": "object", "additionalProperties": False,
            "properties": {"runner_id": {"type": "string"}, "confirm_runner_id": {"type": "string"}},
            "required": ["runner_id", "confirm_runner_id"],
        },
    },
    {
        "name": "prepare_llmweb_starter_dataset",
        "description": "在指定 CPU 训练节点准备并检查固定的入门练习数据。",
        "inputSchema": {
            "type": "object", "additionalProperties": False,
            "properties": {"project_id": {"type": "string"}, "runner_id": {"type": "string"}},
            "required": ["project_id", "runner_id"],
        },
    },
    {
        "name": "start_llmweb_starter_training",
        "description": "启动入门模型的训练前基线、训练、版本选择、复测和模型生成流程。",
        "inputSchema": {
            "type": "object", "additionalProperties": False,
            "properties": {
                "project_id": {"type": "string"}, "runner_id": {"type": "string"}, "dataset_id": {"type": "string"},
                "name": {"type": "string", "minLength": 1, "maxLength": 120},
                "profile": {"type": "string", "enum": ["fast", "balanced", "thorough"]},
                "license_confirmed": {"type": "boolean"},
            },
            "required": ["project_id", "runner_id", "dataset_id", "license_confirmed"],
        },
    },
    {
        "name": "get_llmweb_training_run",
        "description": "读取一次训练的阶段、进度、可操作项、对比指标和模型产物。",
        "inputSchema": {
            "type": "object", "additionalProperties": False,
            "properties": {"project_id": {"type": "string"}, "experiment_id": {"type": "string"}},
            "required": ["project_id", "experiment_id"],
        },
    },
    {
        "name": "select_llmweb_training_result",
        "description": "选定一次训练中推荐或指定的模型版本并继续固定测试集复测。",
        "inputSchema": {
            "type": "object", "additionalProperties": False,
            "properties": {"experiment_id": {"type": "string"}, "checkpoint_ref": {"type": "string"}},
            "required": ["experiment_id"],
        },
    },
    {
        "name": "control_llmweb_training_job",
        "description": "暂停、继续或取消一个明确的 LLMWEB 训练任务。",
        "inputSchema": {
            "type": "object", "additionalProperties": False,
            "properties": {
                "job_id": {"type": "string"},
                "action": {"type": "string", "enum": ["pause", "resume", "cancel"]},
                "confirmation": {"type": "string", "description": "取消时必须传 CONFIRM_CANCEL_TRAINING"},
            },
            "required": ["job_id", "action"],
        },
    },
]


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        if db.get(Workspace, DEFAULT_WORKSPACE_ID) is None:
            db.add(Workspace(id=DEFAULT_WORKSPACE_ID, name="我的工作区"))
            db.commit()
    yield


app = FastAPI(
    title="LLMWEB Control Plane",
    description="Coordinates projects, runners, local datasets, training, evaluation, and model records.",
    version="0.2.1",
    lifespan=lifespan,
)


@app.get("/health", tags=["system"])
def health() -> dict[str, str]:
    return {"service": "llmweb-control-plane", "status": "healthy"}


def as_iso(value):
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


def web_runner(runner: Runner) -> dict[str, Any]:
    settings = get_settings()
    online = runner.last_seen_at is not None and utc_now() - runner.last_seen_at.replace(tzinfo=runner.last_seen_at.tzinfo or timezone.utc) < timedelta(seconds=settings.runner_offline_seconds)
    status_value = runner.status if online else "offline"
    return {
        "id": runner.id,
        "name": runner.name,
        "status": status_value,
        "capabilities": runner.capabilities,
        "current_job_id": runner.current_job_id,
        "last_seen_at": as_iso(runner.last_seen_at),
    }


def job_view(job: Job, events: list[JobEvent] | None = None) -> dict[str, Any]:
    result: dict[str, Any] = {
        "id": job.id,
        "kind": job.kind,
        "status": job.status,
        "desired_state": job.desired_state,
        "progress": job.progress,
        "error": job.error,
        "experiment_id": job.experiment_id,
        "dataset_id": job.dataset_id,
        "created_at": as_iso(job.created_at),
        "started_at": as_iso(job.started_at),
        "finished_at": as_iso(job.finished_at),
    }
    if events is not None:
        result["events"] = [
            {
                "id": event.id,
                "type": event.type,
                "message": event.message,
                "payload": event.payload,
                "created_at": as_iso(event.created_at),
            }
            for event in events
        ]
    return result


def ensure_workspace(db: Session, identity: WebIdentity) -> Workspace:
    workspace = db.get(Workspace, identity.workspace_id)
    if workspace is None:
        label = identity.name or identity.email.split("@", 1)[0]
        workspace = Workspace(id=identity.workspace_id, name=f"{label}的工作区")
        db.add(workspace)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            workspace = db.get(Workspace, identity.workspace_id)
            if workspace is None:
                raise
    return workspace


@app.get("/v1/state", tags=["web"])
def state(
    db: Db,
    identity: WebAuth,
    project_id: Annotated[str | None, Query()] = None,
) -> dict[str, Any]:
    workspace = ensure_workspace(db, identity)
    projects = list(db.scalars(select(Project).where(Project.workspace_id == identity.workspace_id).order_by(Project.created_at.desc())))
    selected_project = None
    if project_id:
        selected_project = db.get(Project, project_id)
        if selected_project is None or selected_project.workspace_id != identity.workspace_id:
            raise HTTPException(status_code=404, detail="项目不存在")
    elif projects:
        selected_project = projects[0]

    runners = list(db.scalars(select(Runner).where(Runner.workspace_id == identity.workspace_id).order_by(Runner.created_at)))
    if selected_project is None:
        datasets: list[Dataset] = []
        experiments: list[Experiment] = []
        jobs: list[Job] = []
    else:
        datasets = list(db.scalars(select(Dataset).where(
            Dataset.workspace_id == identity.workspace_id,
            Dataset.project_id == selected_project.id,
        ).order_by(Dataset.created_at.desc())))
        experiments = list(db.scalars(select(Experiment).where(
            Experiment.workspace_id == identity.workspace_id,
            Experiment.project_id == selected_project.id,
        ).order_by(Experiment.created_at.desc())))
        dataset_ids = [item.id for item in datasets]
        experiment_ids = [item.id for item in experiments]
        if dataset_ids or experiment_ids:
            job_scope = []
            if dataset_ids:
                job_scope.append(Job.dataset_id.in_(dataset_ids))
            if experiment_ids:
                job_scope.append(Job.experiment_id.in_(experiment_ids))
            jobs = list(db.scalars(select(Job).where(
                Job.workspace_id == identity.workspace_id,
                or_(*job_scope),
            ).order_by(Job.created_at.desc())))
        else:
            jobs = []
    job_ids = [item.id for item in jobs]
    recent_events = list(db.scalars(
        select(JobEvent).where(JobEvent.job_id.in_(job_ids)).order_by(JobEvent.id.desc()).limit(200)
    )) if job_ids else []
    events_by_job: dict[str, list[JobEvent]] = {}
    for event in reversed(recent_events):
        events_by_job.setdefault(event.job_id, []).append(event)

    return {
        "workspace": {"id": workspace.id, "name": workspace.name},
        "account": {
            "email": identity.email,
            "name": identity.name,
        },
        "project_quota": {
            "used": len(projects),
            "limit": identity.project_limit,
            "remaining": max(0, identity.project_limit - len(projects)),
        },
        "current_project_id": selected_project.id if selected_project else None,
        "projects": [
            {"id": item.id, "name": item.name, "goal": item.goal, "success_criteria": item.success_criteria, "created_at": as_iso(item.created_at)}
            for item in projects
        ],
        "runners": [web_runner(item) for item in runners if not item.revoked],
        "datasets": [
            {
                "id": item.id,
                "project_id": item.project_id,
                "runner_id": item.runner_id,
                "name": item.name,
                "source_type": item.source_type,
                "source_ref": item.source_ref,
                "format": item.format,
                "mapping": item.mapping,
                "split": item.split,
                "status": item.status,
                "version_hash": item.version_hash,
                "statistics": item.statistics,
                "preview": item.preview if item.preview_allowed else None,
                "created_at": as_iso(item.created_at),
            }
            for item in datasets
        ],
        "experiments": [
            {
                "id": item.id,
                "project_id": item.project_id,
                "runner_id": item.runner_id,
                "dataset_id": item.dataset_id,
                "name": item.name,
                "model": item.model,
                "training": item.training,
                "export_formats": item.export_formats,
                "output_destination": item.output_destination,
                "output_s3_uri": item.output_s3_uri,
                "license_confirmed": item.license_confirmed,
                "status": item.status,
                "current_stage": item.current_stage,
                "baseline_metrics": item.baseline_metrics,
                "tuned_metrics": item.tuned_metrics,
                "artifacts": item.artifacts,
                "evaluation_samples": item.evaluation_samples if item.evaluation_preview_allowed else None,
                "checkpoints": item.checkpoints,
                "selected_checkpoint": item.selected_checkpoint,
                "created_at": as_iso(item.created_at),
            }
            for item in experiments
        ],
        "jobs": [job_view(item, events_by_job.get(item.id, [])) for item in jobs],
    }


def api_connection_view(connection: ApiConnection) -> dict[str, Any]:
    return {
        "id": connection.id,
        "name": connection.name,
        "purpose": connection.purpose,
        "capabilities": connection.granted_capabilities,
        "credential_hint": connection.credential_hint,
        "status": connection.status,
        "created_at": as_iso(connection.created_at),
        "rotated_at": as_iso(connection.rotated_at),
        "last_used_at": as_iso(connection.last_used_at),
        "revoked_at": as_iso(connection.revoked_at),
    }


def issue_api_credential() -> tuple[str, str, str]:
    credential = "llmweb_api_" + secrets.token_urlsafe(32)
    return credential, digest_secret(credential), credential[-6:]


@app.get("/v1/api-connections", tags=["web"])
def list_api_connections(db: Db, identity: WebAuth) -> dict[str, Any]:
    ensure_workspace(db, identity)
    connections = list(db.scalars(select(ApiConnection).where(
        ApiConnection.workspace_id == identity.workspace_id,
        ApiConnection.passport_user_id == identity.user_id,
    ).order_by(ApiConnection.created_at.desc())))
    events = list(db.scalars(select(ApiAuditEvent).where(
        ApiAuditEvent.workspace_id == identity.workspace_id,
        ApiAuditEvent.actor_user_id == identity.user_id,
    ).order_by(ApiAuditEvent.occurred_at.desc()).limit(50)))
    return {
        "connections": [api_connection_view(item) for item in connections],
        "recent_activity": [{
            "id": item.id,
            "connection_id": item.connection_id,
            "action": item.action,
            "target_type": item.target_type,
            "target_id": item.target_id,
            "outcome": item.outcome,
            "occurred_at": as_iso(item.occurred_at),
        } for item in events],
    }


@app.post("/v1/api-connections", status_code=status.HTTP_201_CREATED, tags=["web"])
def create_api_connection(body: ApiConnectionCreate, db: Db, identity: WebAuth) -> dict[str, Any]:
    ensure_workspace(db, identity)
    credential, credential_hash, credential_hint = issue_api_credential()
    connection = ApiConnection(
        workspace_id=identity.workspace_id,
        passport_user_id=identity.user_id,
        account_email=identity.email,
        account_name=identity.name,
        name=body.name.strip(),
        purpose=body.purpose.strip(),
        granted_capabilities=body.capabilities,
        credential_hash=credential_hash,
        credential_hint=credential_hint,
    )
    db.add(connection)
    db.commit()
    return {"connection": api_connection_view(connection), "credential": credential}


def owned_api_connection(db: Session, connection_id: str, identity: WebIdentity) -> ApiConnection:
    connection = db.get(ApiConnection, connection_id)
    if connection is None or connection.workspace_id != identity.workspace_id or connection.passport_user_id != identity.user_id:
        raise HTTPException(status_code=404, detail="API 连接不存在")
    return connection


@app.post("/v1/api-connections/{connection_id}/rotate", tags=["web"])
def rotate_api_connection(connection_id: str, db: Db, identity: WebAuth) -> dict[str, Any]:
    connection = owned_api_connection(db, connection_id, identity)
    if connection.status != "active" or connection.revoked_at is not None:
        raise HTTPException(status_code=409, detail="已撤销的 API 连接不能轮换")
    credential, connection.credential_hash, connection.credential_hint = issue_api_credential()
    connection.rotated_at = utc_now()
    db.commit()
    return {"connection": api_connection_view(connection), "credential": credential}


@app.post("/v1/api-connections/{connection_id}/revoke", tags=["web"])
def revoke_api_connection(connection_id: str, db: Db, identity: WebAuth) -> dict[str, Any]:
    connection = owned_api_connection(db, connection_id, identity)
    if connection.revoked_at is None:
        connection.revoked_at = utc_now()
        connection.status = "revoked"
        db.commit()
    return {"connection": api_connection_view(connection)}


@app.post("/v1/api-connections/resolve", tags=["internal"])
def resolve_api_connection_for_web(
    db: Db,
    authorization: Annotated[str | None, Header()] = None,
    api_credential: Annotated[str | None, Header(alias="X-LLMWEB-API-Credential")] = None,
) -> dict[str, Any]:
    require_internal_web(authorization)
    if not api_credential:
        raise HTTPException(status_code=401, detail="API 连接凭证缺失")
    connection = resolve_api_connection(db, api_credential)
    db.commit()
    return {
        "connection": api_connection_view(connection),
        "identity": {
            "user_id": connection.passport_user_id,
            "email": connection.account_email,
            "name": connection.account_name,
            "workspace_id": connection.workspace_id,
        },
    }


@app.post("/v1/projects", status_code=status.HTTP_201_CREATED, tags=["web"])
def create_project(body: ProjectCreate, db: Db, identity: WebAuth) -> dict[str, str]:
    ensure_workspace(db, identity)
    db.execute(select(Workspace).where(Workspace.id == identity.workspace_id).with_for_update()).scalar_one()
    project_count = db.scalar(select(func.count(Project.id)).where(Project.workspace_id == identity.workspace_id)) or 0
    if project_count >= identity.project_limit:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"当前最多可以建立 {identity.project_limit} 个项目。已有项目会继续保留。",
        )
    project = Project(workspace_id=identity.workspace_id, **body.model_dump())
    db.add(project)
    db.commit()
    return {"id": project.id}


@app.post("/v1/runners/pairing", status_code=status.HTTP_201_CREATED, tags=["web"])
def create_pairing(db: Db, identity: WebAuth) -> dict[str, Any]:
    settings = get_settings()
    ensure_workspace(db, identity)
    code = secrets.token_urlsafe(6).upper().replace("-", "")[:8]
    pairing = PairingCode(
        workspace_id=identity.workspace_id,
        code_hash=digest_secret(code),
        expires_at=utc_now() + timedelta(minutes=settings.pairing_ttl_minutes),
    )
    db.add(pairing)
    db.commit()
    return {
        "code": code,
        "expires_at": as_iso(pairing.expires_at),
        "command": (
            f"curl -fsSL {shlex.quote(settings.runner_installer_url)} | "
            f"sudo bash -s -- --url {shlex.quote(settings.public_url)} --code {shlex.quote(code)} "
            f"--source-ref {shlex.quote(settings.runner_source_ref)}"
        ),
    }


@app.post("/v1/runners/pair", status_code=status.HTTP_201_CREATED, tags=["runner"])
def pair_runner(body: PairRequest, db: Db) -> dict[str, str]:
    pairing = db.scalar(select(PairingCode).where(PairingCode.code_hash == digest_secret(body.code)))
    if pairing is None or pairing.used_at is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="配对码无效或已经使用")
    expires_at = pairing.expires_at.replace(tzinfo=pairing.expires_at.tzinfo or timezone.utc)
    if expires_at <= utc_now():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="配对码已过期，请在网页重新生成")
    token = secrets.token_urlsafe(32)
    runner = Runner(
        workspace_id=pairing.workspace_id,
        name=body.name,
        token_hash=digest_secret(token),
        capabilities=body.capabilities,
        status="online",
        last_seen_at=utc_now(),
    )
    pairing.used_at = utc_now()
    db.add(runner)
    db.commit()
    return {"runner_id": runner.id, "device_token": token}


@app.post("/v1/runners/upgrade-authorization", tags=["runner"])
def authorize_runner_upgrade(
    body: RunnerUpgradeAuthorization,
    db: Db,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, bool]:
    runner = require_runner(db, authorization)
    pairing = db.scalar(select(PairingCode).where(PairingCode.code_hash == digest_secret(body.code)))
    if pairing is None or pairing.used_at is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="配对码无效或已经使用")
    expires_at = pairing.expires_at.replace(tzinfo=pairing.expires_at.tzinfo or timezone.utc)
    if expires_at <= utc_now():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="配对码已过期，请在网页重新生成")
    if pairing.workspace_id != runner.workspace_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="这台电脑属于另一个训练工作区")
    pairing.used_at = utc_now()
    db.commit()
    return {"authorized": True}


@app.post("/v1/runners/heartbeat", tags=["runner"])
def heartbeat(body: HeartbeatRequest, db: Db, authorization: Annotated[str | None, Header()] = None) -> dict[str, Any]:
    runner = require_runner(db, authorization)
    runner.capabilities = body.capabilities
    runner.last_seen_at = utc_now()
    runner.current_job_id = body.active_job_id
    runner.status = "busy" if body.active_job_id else "online"
    controls: list[dict[str, str]] = []
    if body.active_job_id:
        job = db.get(Job, body.active_job_id)
        if job is not None and job.runner_id == runner.id and (job.desired_state != "running" or job.status == "paused"):
            controls.append({"job_id": job.id, "action": job.desired_state})
    db.commit()
    return {"runner_id": runner.id, "controls": controls}


def revoke_runner(db: Session, identity: WebIdentity, runner_id: str, confirm_runner_id: str) -> dict[str, Any]:
    if not runner_id or confirm_runner_id != runner_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="confirm_runner_id 必须与 runner_id 完全一致")
    runner = db.get(Runner, runner_id)
    if runner is None or runner.workspace_id != identity.workspace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="算力连接不存在")
    if runner.revoked:
        return {"runner_id": runner.id, "revoked": True, "already_revoked": True}
    active_job = db.scalar(select(Job).where(
        Job.runner_id == runner.id,
        Job.status.in_(["blocked", "queued", "leased", "running", "paused"]),
    ).limit(1))
    if active_job is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="这台算力仍有未结束任务，不能撤销连接")
    runner.revoked = True
    runner.status = "offline"
    runner.current_job_id = None
    db.commit()
    return {"runner_id": runner.id, "revoked": True, "already_revoked": False}


def _create_dataset(
    body: DatasetCreate,
    db: Session,
    identity: WebIdentity,
    *,
    commit: bool = True,
) -> dict[str, str]:
    project = db.get(Project, body.project_id)
    runner = db.get(Runner, body.runner_id)
    if project is None or project.workspace_id != identity.workspace_id:
        raise HTTPException(status_code=404, detail="项目不存在")
    if runner is None or runner.workspace_id != identity.workspace_id or runner.revoked:
        raise HTTPException(status_code=404, detail="算力连接不存在")
    if body.source_type == "starter":
        if body.source_ref != "tiny-shakespeare" or body.format != "txt":
            raise HTTPException(status_code=400, detail="入门练习数据由系统自动准备")
        if runner.capabilities.get("backend") != "docker_cpu":
            raise HTTPException(status_code=400, detail="入门练习数据用于普通 CPU 算力")
    dataset = Dataset(
        workspace_id=identity.workspace_id,
        project_id=body.project_id,
        runner_id=body.runner_id,
        name=body.name,
        source_type=body.source_type,
        source_ref=body.source_ref,
        format=body.format,
        mapping={"instruction": body.instruction_field, "input": body.input_field, "output": body.output_field},
        split={"train": body.train_percent, "validation": body.validation_percent, "test": body.test_percent},
        preview_allowed=body.preview_allowed,
    )
    db.add(dataset)
    db.flush()
    job = Job(
        workspace_id=identity.workspace_id,
        runner_id=body.runner_id,
        dataset_id=dataset.id,
        kind="inspect",
        payload={
            "schema_version": "1.0",
            "dataset_id": dataset.id,
            "source_ref": dataset.source_ref,
            "source_type": dataset.source_type,
            "format": dataset.format,
            "mapping": dataset.mapping,
            "split": dataset.split,
            "preview_allowed": dataset.preview_allowed,
        },
    )
    db.add(job)
    if commit:
        db.commit()
    else:
        db.flush()
    return {"id": dataset.id, "job_id": job.id}


@app.post("/v1/datasets", status_code=status.HTTP_201_CREATED, tags=["web"])
def create_dataset(
    body: DatasetCreate,
    db: Db,
    identity: WebAuth,
    request_id: Annotated[str | None, Header(alias="X-Request-ID")] = None,
    api_connection_id: Annotated[str | None, Header(alias="X-LLMWEB-API-Connection-ID")] = None,
) -> dict[str, str]:
    return durable_user_api_submission(
        db, identity, api_connection_id, request_id, "create_dataset", body.model_dump(),
        lambda: _create_dataset(body, db, identity, commit=False),
    )


def infer_template(model_id: str) -> str:
    normalized = model_id.lower()
    if "qwen" in normalized:
        return "qwen"
    if "llama-3" in normalized or "llama3" in normalized:
        return "llama3"
    if "mistral" in normalized:
        return "mistral"
    if "gemma" in normalized:
        return "gemma"
    return "default"


def _create_experiment(
    body: ExperimentCreate,
    db: Session,
    identity: WebIdentity,
    *,
    commit: bool = True,
) -> dict[str, Any]:
    project = db.get(Project, body.project_id)
    runner = db.get(Runner, body.runner_id)
    dataset = db.get(Dataset, body.dataset_id)
    if project is None or runner is None or dataset is None:
        raise HTTPException(status_code=404, detail="项目、数据或算力连接不存在")
    if any(item.workspace_id != identity.workspace_id for item in (project, runner, dataset)):
        raise HTTPException(status_code=404, detail="项目、数据或算力连接不存在")
    if dataset.status != "ready":
        raise HTTPException(status_code=409, detail="请等待数据检查完成后再开始训练")
    if dataset.project_id != project.id or dataset.runner_id != runner.id:
        raise HTTPException(status_code=400, detail="项目、数据和算力连接不属于同一训练流程")
    revision = APPROVED_MODELS.get(body.model_id)
    if revision is None:
        raise HTTPException(status_code=400, detail="请选择工作台提供的训练方案")
    backend = runner.capabilities.get("backend")
    if backend == "docker_cpu":
        if body.method != "starter" or body.model_id != "karpathy/nanoGPT" or dataset.source_type != "starter":
            raise HTTPException(status_code=400, detail="这台普通电脑使用入门训练方案；模型、练习数据和训练设置会由系统自动匹配")
        disk_free_mb = runner.capabilities.get("disk_free_mb")
        if isinstance(disk_free_mb, (int, float)) and disk_free_mb < 20 * 1024:
            raise HTTPException(status_code=409, detail="这台电脑的可用空间不足 20GB，请先扩充或腾出空间再开始训练")
        if body.output_destination != "local":
            raise HTTPException(status_code=400, detail="入门训练结果会先保存在这台电脑，完成后可从模型页查看")
    elif body.method == "starter":
        raise HTTPException(status_code=400, detail="入门训练方案需要选择普通 CPU 算力")
    if runner.capabilities.get("backend") == "native_mps" and body.method == "qlora":
        raise HTTPException(status_code=400, detail="Apple Silicon 当前使用 Metal/MPS LoRA；4 位 QLoRA 需要 CUDA 量化后端")

    is_starter = body.method == "starter"
    installed_environment_version = runner.capabilities.get("training_environment_version")
    if not isinstance(installed_environment_version, str) or not installed_environment_version:
        installed_environment_version = "legacy-0.1.0"
    environment_backend = {
        "docker_cpu": "linux-amd64-cpu",
        "docker_cuda": "linux-amd64-cuda",
        "native_mps": "darwin-arm64-mps",
    }.get(backend, backend or "unknown")
    model = {
        "source": "github" if is_starter else "huggingface",
        "id": body.model_id,
        "revision": revision,
        "template": "character" if is_starter else infer_template(body.model_id),
    }
    training = {
        "method": body.method,
        "epochs": body.epochs,
        "learning_rate": body.learning_rate,
        "max_length": body.max_length,
        "batch_size": body.batch_size,
        "gradient_accumulation": body.gradient_accumulation,
    }
    if is_starter:
        training["iterations"] = 200 if body.epochs <= 1 else 500 if body.epochs <= 3 else 1000
    experiment = Experiment(
        workspace_id=identity.workspace_id,
        project_id=project.id,
        runner_id=runner.id,
        dataset_id=dataset.id,
        name=body.name,
        model=model,
        training=training,
        export_formats=["model"] if is_starter else list(dict.fromkeys(body.export_formats)),
        output_destination=body.output_destination,
        output_s3_uri=body.output_s3_uri,
        output_s3_endpoint=body.output_s3_endpoint,
        license_confirmed=body.license_confirmed,
        evaluation_preview_allowed=body.evaluation_preview_allowed,
    )
    db.add(experiment)
    db.flush()
    common = {
        "schema_version": "1.0",
        "workspace_id": identity.workspace_id,
        "project_id": project.id,
        "experiment_id": experiment.id,
        "dataset_id": dataset.id,
        "model": model,
        "training": training,
        "runtime": {
            "engine": "nanogpt" if is_starter else "llamafactory",
            "image": (
                f"llmweb/runtime-cpu:{installed_environment_version}"
                if is_starter and installed_environment_version != "legacy-0.1.0"
                else "llmweb/runtime-cpu:0.1.0" if is_starter else "llmweb/runtime:0.1.0"
            ),
        },
        "environment": {"version": installed_environment_version, "backend": environment_backend},
    }
    jobs = []
    for sequence, kind in enumerate(("baseline", "train", "evaluate", "export")):
        payload = {**common, "task": kind, "output": {"formats": experiment.export_formats, "preview_allowed": experiment.evaluation_preview_allowed, "destination": experiment.output_destination, "s3_uri": experiment.output_s3_uri, "s3_endpoint": experiment.output_s3_endpoint}}
        job = Job(
            workspace_id=identity.workspace_id,
            runner_id=runner.id,
            dataset_id=dataset.id,
            experiment_id=experiment.id,
            kind=kind,
            sequence=sequence,
            payload=payload,
            status="blocked" if kind in {"evaluate", "export"} else "queued",
        )
        db.add(job)
        jobs.append(job)
    if commit:
        db.commit()
    else:
        db.flush()
    return {"id": experiment.id, "job_ids": [job.id for job in jobs]}


@app.post("/v1/experiments", status_code=status.HTTP_201_CREATED, tags=["web"])
def create_experiment(
    body: ExperimentCreate,
    db: Db,
    identity: WebAuth,
    request_id: Annotated[str | None, Header(alias="X-Request-ID")] = None,
    api_connection_id: Annotated[str | None, Header(alias="X-LLMWEB-API-Connection-ID")] = None,
) -> dict[str, Any]:
    return durable_user_api_submission(
        db, identity, api_connection_id, request_id, "create_experiment", body.model_dump(),
        lambda: _create_experiment(body, db, identity, commit=False),
    )


def previous_jobs_complete(db: Session, job: Job) -> bool:
    if job.experiment_id is None:
        return True
    previous = list(db.scalars(select(Job).where(Job.experiment_id == job.experiment_id, Job.sequence < job.sequence)))
    return all(item.status == "completed" for item in previous)


@app.post("/v1/runners/jobs/lease", tags=["runner"])
def lease_job(db: Db, response: Response, authorization: Annotated[str | None, Header()] = None) -> dict[str, Any] | None:
    runner = require_runner(db, authorization)
    candidates = list(db.scalars(select(Job).where(Job.runner_id == runner.id, Job.status == "queued").order_by(Job.created_at, Job.sequence)))
    job = next((item for item in candidates if previous_jobs_complete(db, item)), None)
    if job is None:
        response.status_code = status.HTTP_204_NO_CONTENT
        return None
    lease_id = new_id("lease")
    job.lease_id = lease_id
    job.status = "leased"
    job.leased_at = utc_now()
    runner.current_job_id = job.id
    runner.status = "busy"
    runner.last_seen_at = utc_now()
    if job.experiment_id:
        experiment = db.get(Experiment, job.experiment_id)
        if experiment:
            experiment.status = "running"
            experiment.current_stage = job.kind
    db.commit()
    return {"job_id": job.id, "lease_id": lease_id, "kind": job.kind, "payload": job.payload, "desired_state": job.desired_state}


def update_completed_result(db: Session, job: Job, payload: dict[str, Any]) -> None:
    if job.kind == "inspect" and job.dataset_id:
        dataset = db.get(Dataset, job.dataset_id)
        if dataset:
            dataset.status = "ready"
            dataset.version_hash = payload.get("version_hash")
            dataset.statistics = payload.get("statistics", {})
            dataset.preview = payload.get("preview") if dataset.preview_allowed else None
    if not job.experiment_id:
        return
    experiment = db.get(Experiment, job.experiment_id)
    if experiment is None:
        return
    if job.kind == "baseline":
        experiment.baseline_metrics = payload.get("metrics", {})
        if experiment.evaluation_preview_allowed:
            samples = dict(experiment.evaluation_samples or {})
            samples["baseline"] = payload.get("preview", [])
            experiment.evaluation_samples = samples
    elif job.kind == "evaluate":
        experiment.tuned_metrics = payload.get("metrics", {})
        if experiment.evaluation_preview_allowed:
            samples = dict(experiment.evaluation_samples or {})
            samples["tuned"] = payload.get("preview", [])
            experiment.evaluation_samples = samples
        export_job = db.scalar(select(Job).where(Job.experiment_id == experiment.id, Job.kind == "export"))
        if export_job and export_job.status == "blocked":
            export_job.status = "queued"
        experiment.current_stage = "export"
    elif job.kind == "train":
        checkpoints = payload.get("checkpoints") or [{"reference": "adapter", "label": "最终训练结果", "recommended": True}]
        experiment.checkpoints = checkpoints
        experiment.status = "awaiting_selection"
        experiment.current_stage = "select"
    elif job.kind == "export":
        experiment.artifacts = payload.get("artifacts", [])
        experiment.status = "completed"
        experiment.current_stage = "completed"


@app.post("/v1/runners/jobs/{job_id}/events", status_code=status.HTTP_202_ACCEPTED, tags=["runner"])
def ingest_events(job_id: str, body: EventBatch, db: Db, authorization: Annotated[str | None, Header()] = None) -> dict[str, int]:
    runner = require_runner(db, authorization)
    job = db.get(Job, job_id)
    if job is None or job.runner_id != runner.id or job.lease_id != body.lease_id:
        raise HTTPException(status_code=409, detail="任务租约无效")
    accepted = 0
    for incoming in body.events:
        if db.scalar(select(JobEvent).where(JobEvent.event_id == incoming.event_id)) is not None:
            continue
        event = JobEvent(job_id=job.id, event_id=incoming.event_id, type=incoming.type, message=incoming.message, payload=incoming.payload)
        db.add(event)
        accepted += 1
        if incoming.type == "accepted":
            job.status = "running"
            job.started_at = job.started_at or utc_now()
        elif incoming.type == "progress":
            job.progress = max(0, min(100, int(incoming.payload.get("percent", job.progress))))
            if job.status == "paused" and job.desired_state == "running":
                job.status = "running"
        elif incoming.type == "paused":
            job.status = "paused"
        elif incoming.type == "completed":
            job.status = "completed"
            job.progress = 100
            job.finished_at = utc_now()
            update_completed_result(db, job, incoming.payload)
            runner.current_job_id = None
            runner.status = "online"
        elif incoming.type == "failed":
            job.status = "failed"
            job.error = incoming.message or "任务执行失败"
            job.finished_at = utc_now()
            runner.current_job_id = None
            runner.status = "online"
            if job.dataset_id and job.kind == "inspect":
                dataset = db.get(Dataset, job.dataset_id)
                if dataset:
                    dataset.status = "failed"
            if job.experiment_id:
                experiment = db.get(Experiment, job.experiment_id)
                if experiment:
                    experiment.status = "failed"
                    experiment.current_stage = job.kind
                for pending in db.scalars(select(Job).where(Job.experiment_id == job.experiment_id, Job.status.in_(["queued", "blocked"]))):
                    pending.status = "cancelled"
                    pending.finished_at = utc_now()
        elif incoming.type == "cancelled":
            job.status = "cancelled"
            job.error = None
            job.finished_at = utc_now()
            runner.current_job_id = None
            runner.status = "online"
            if job.experiment_id:
                experiment = db.get(Experiment, job.experiment_id)
                if experiment:
                    experiment.status = "cancelled"
                    experiment.current_stage = job.kind
                for pending in db.scalars(select(Job).where(Job.experiment_id == job.experiment_id, Job.status.in_(["queued", "blocked"]))):
                    pending.status = "cancelled"
                    pending.finished_at = utc_now()
    runner.last_seen_at = utc_now()
    db.commit()
    return {"accepted": accepted}


@app.post("/v1/experiments/{experiment_id}/select-checkpoint", tags=["web"])
def select_checkpoint(experiment_id: str, body: CheckpointSelect, db: Db, identity: WebAuth) -> dict[str, str]:
    experiment = db.get(Experiment, experiment_id)
    if experiment is None or experiment.workspace_id != identity.workspace_id:
        raise HTTPException(status_code=404, detail="训练不存在")
    if experiment.status != "awaiting_selection":
        raise HTTPException(status_code=409, detail="当前训练还没有可选择的版本")
    references = {str(item.get("reference")) for item in experiment.checkpoints or []}
    if body.checkpoint_ref not in references:
        raise HTTPException(status_code=400, detail="选择的模型版本不属于本次训练")
    experiment.selected_checkpoint = body.checkpoint_ref
    experiment.status = "running"
    experiment.current_stage = "evaluate"
    evaluate_job = db.scalar(select(Job).where(Job.experiment_id == experiment.id, Job.kind == "evaluate"))
    export_job = db.scalar(select(Job).where(Job.experiment_id == experiment.id, Job.kind == "export"))
    if evaluate_job is None or export_job is None:
        raise HTTPException(status_code=409, detail="训练流程不完整，无法继续评测")
    evaluate_job.payload = {**evaluate_job.payload, "selected_checkpoint": body.checkpoint_ref}
    export_job.payload = {**export_job.payload, "selected_checkpoint": body.checkpoint_ref}
    evaluate_job.status = "queued"
    db.commit()
    return {"experiment_id": experiment.id, "selected_checkpoint": body.checkpoint_ref}


@app.post("/v1/jobs/{job_id}/control", tags=["web"])
def control_job(job_id: str, body: JobControl, db: Db, identity: WebAuth) -> dict[str, str]:
    job = db.get(Job, job_id)
    if job is None or job.workspace_id != identity.workspace_id:
        raise HTTPException(status_code=404, detail="任务不存在")
    if job.status in {"completed", "failed", "cancelled"}:
        raise HTTPException(status_code=409, detail="任务已经结束")
    if body.action == "pause":
        job.desired_state = "paused"
    elif body.action == "resume":
        job.desired_state = "running"
    else:
        job.desired_state = "cancelled"
        if job.status == "queued":
            job.status = "cancelled"
            job.finished_at = utc_now()
            if job.experiment_id:
                experiment = db.get(Experiment, job.experiment_id)
                if experiment:
                    experiment.status = "cancelled"
                    experiment.current_stage = job.kind
                for pending in db.scalars(select(Job).where(Job.experiment_id == job.experiment_id, Job.status.in_(["queued", "blocked"]))):
                    pending.status = "cancelled"
                    pending.finished_at = utc_now()
    db.commit()
    return {"job_id": job.id, "desired_state": job.desired_state}


def user_api_state_summary(db: Session, identity: WebIdentity, project_id: str | None = None) -> dict[str, Any]:
    snapshot = state(db, identity, project_id)
    return {
        "workspace": snapshot["workspace"],
        "projects": snapshot["projects"],
        "training_pool": snapshot["runners"],
        "datasets": snapshot["datasets"],
        "training_runs": [
            {
                "id": item["id"], "project_id": item["project_id"], "runner_id": item["runner_id"],
                "dataset_id": item["dataset_id"], "name": item["name"], "status": item["status"],
                "current_stage": item["current_stage"], "baseline_metrics": item["baseline_metrics"],
                "tuned_metrics": item["tuned_metrics"], "checkpoints": item["checkpoints"],
                "selected_checkpoint": item["selected_checkpoint"], "artifacts": item["artifacts"],
            }
            for item in snapshot["experiments"]
        ],
        "jobs": [
            {
                "id": item["id"], "kind": item["kind"], "status": item["status"],
                "desired_state": item["desired_state"], "progress": item["progress"],
                "error": item["error"], "experiment_id": item["experiment_id"], "dataset_id": item["dataset_id"],
            }
            for item in snapshot["jobs"]
        ],
    }


@app.get("/v1/user-api/capabilities", tags=["user-api"])
def user_api_capabilities() -> dict[str, Any]:
    return {"version": "1", "tools": USER_API_TOOL_CATALOG}


@app.get("/v1/training-pool", tags=["user-api"])
def get_training_pool(db: Db, identity: WebAuth, project_id: Annotated[str | None, Query()] = None) -> dict[str, Any]:
    return user_api_state_summary(db, identity, project_id)


@app.get("/v1/experiments/{experiment_id}", tags=["user-api"])
def get_training_run(experiment_id: str, db: Db, identity: WebAuth) -> dict[str, Any]:
    experiment = db.get(Experiment, experiment_id)
    if experiment is None or experiment.workspace_id != identity.workspace_id:
        raise HTTPException(status_code=404, detail="训练不存在")
    summary = user_api_state_summary(db, identity, experiment.project_id)
    run = next(item for item in summary["training_runs"] if item["id"] == experiment_id)
    return {"training_run": run, "jobs": [item for item in summary["jobs"] if item["experiment_id"] == experiment_id]}


@app.post("/v1/runners/{runner_id}/revoke", tags=["user-api"])
def revoke_user_api_runner(runner_id: str, body: dict[str, Any], db: Db, identity: WebAuth) -> dict[str, Any]:
    return revoke_runner(db, identity, runner_id, str(body.get("confirm_runner_id") or ""))


def record_api_audit(
    db: Session,
    connection: ApiConnection,
    request_id: str,
    action: str,
    outcome: str,
    params: dict[str, Any],
    *,
    commit: bool = True,
) -> None:
    target_type = next((key.removesuffix("_id") for key in ("experiment_id", "job_id", "project_id", "runner_id", "dataset_id") if params.get(key)), None)
    target_id = next((str(params[key]) for key in ("experiment_id", "job_id", "project_id", "runner_id", "dataset_id") if params.get(key)), None)
    event = db.scalar(select(ApiAuditEvent).where(
        ApiAuditEvent.connection_id == connection.id,
        ApiAuditEvent.request_id == request_id,
    ))
    if event is None:
        event = ApiAuditEvent(
            connection_id=connection.id,
            workspace_id=connection.workspace_id,
            actor_user_id=connection.passport_user_id,
            request_id=request_id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            outcome=outcome,
            safe_request_summary={"parameter_names": sorted(params.keys())},
        )
        db.add(event)
    else:
        event.action = action
        event.target_type = target_type
        event.target_id = target_id
        event.outcome = outcome
        event.safe_request_summary = {"parameter_names": sorted(params.keys())}
        event.occurred_at = utc_now()
    if commit:
        db.commit()


def api_request_fingerprint(action: str, params: dict[str, Any]) -> str:
    canonical = json.dumps({"action": action, "params": params}, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


def read_api_request_receipt(
    db: Session,
    connection: ApiConnection,
    request_id: str,
    action: str,
    fingerprint: str,
) -> dict[str, Any] | None:
    receipt = db.scalar(select(ApiRequestReceipt).where(
        ApiRequestReceipt.connection_id == connection.id,
        ApiRequestReceipt.request_id == request_id,
    ))
    if receipt is None:
        return None
    if receipt.action != action or receipt.request_fingerprint != fingerprint:
        raise HTTPException(status_code=409, detail="同一请求身份不能用于不同的训练提交")
    return receipt.result


def durable_user_api_submission(
    db: Session,
    identity: WebIdentity,
    api_connection_id: str | None,
    request_id: str | None,
    action: str,
    params: dict[str, Any],
    create_result,
) -> dict[str, Any]:
    if not api_connection_id:
        result = create_result()
        db.commit()
        return result
    if not request_id:
        raise HTTPException(status_code=400, detail="创建动作必须提供稳定请求身份")
    connection = owned_api_connection(db, api_connection_id, identity)
    if connection.status != "active" or connection.revoked_at is not None:
        raise HTTPException(status_code=401, detail="API 连接已撤销")
    fingerprint = api_request_fingerprint(action, params)
    accepted = read_api_request_receipt(db, connection, request_id, action, fingerprint)
    if accepted is not None:
        return accepted
    try:
        result = create_result()
        db.add(ApiRequestReceipt(
            connection_id=connection.id,
            workspace_id=connection.workspace_id,
            request_id=request_id,
            action=action,
            request_fingerprint=fingerprint,
            result=result,
        ))
        record_api_audit(db, connection, request_id, action, "succeeded", params, commit=False)
        db.commit()
        return result
    except IntegrityError:
        db.rollback()
        accepted = read_api_request_receipt(db, connection, request_id, action, fingerprint)
        if accepted is None:
            raise
        return accepted


@app.post("/v1/api-connections/audit", status_code=status.HTTP_201_CREATED, tags=["internal"])
def create_api_audit_event(
    body: ApiAuditCreate,
    db: Db,
    authorization: Annotated[str | None, Header()] = None,
    api_connection_id: Annotated[str | None, Header(alias="X-LLMWEB-API-Connection-ID")] = None,
) -> dict[str, str]:
    require_internal_web(authorization)
    if not api_connection_id:
        raise HTTPException(status_code=401, detail="API 连接身份缺失")
    connection = db.get(ApiConnection, api_connection_id)
    if connection is None:
        raise HTTPException(status_code=404, detail="API 连接不存在")
    existing = db.scalar(select(ApiAuditEvent).where(
        ApiAuditEvent.connection_id == connection.id,
        ApiAuditEvent.request_id == body.request_id,
    ))
    if existing is not None:
        return {"id": existing.id}
    event = ApiAuditEvent(
        connection_id=connection.id,
        workspace_id=connection.workspace_id,
        actor_user_id=connection.passport_user_id,
        request_id=body.request_id,
        action=body.action,
        target_type=body.target_type,
        target_id=body.target_id,
        outcome=body.outcome,
        safe_request_summary={"parameter_names": sorted(set(body.parameter_names))},
    )
    db.add(event)
    db.commit()
    return {"id": event.id}
