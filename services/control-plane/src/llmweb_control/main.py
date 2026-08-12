from contextlib import asynccontextmanager
from datetime import timedelta, timezone
import hmac
import secrets
import shlex
from typing import Annotated, Any

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .database import Base, engine, get_db
from .models import Dataset, Experiment, Job, JobEvent, PairingCode, Project, Runner, Workspace, new_id, utc_now
from .schemas import CheckpointSelect, DatasetCreate, EventBatch, ExperimentCreate, HeartbeatRequest, JobControl, PairRequest, ProjectCreate
from .security import WebIdentity, digest_secret, require_runner, require_web
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
CLOUDMCP_PROVIDER_ID = "llmweb_training"
CLOUDMCP_PROVIDER_VERSION = "1.0"
CLOUDMCP_TOOL_CATALOG = [
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
            "properties": {"job_id": {"type": "string"}, "action": {"type": "string", "enum": ["pause", "resume", "cancel"]}},
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
    version="0.2.0",
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


@app.post("/v1/datasets", status_code=status.HTTP_201_CREATED, tags=["web"])
def create_dataset(body: DatasetCreate, db: Db, identity: WebAuth) -> dict[str, str]:
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
    db.commit()
    return {"id": dataset.id, "job_id": job.id}


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


@app.post("/v1/experiments", status_code=status.HTTP_201_CREATED, tags=["web"])
def create_experiment(body: ExperimentCreate, db: Db, identity: WebAuth) -> dict[str, Any]:
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
            "image": "llmweb/runtime-cpu:0.1.0" if is_starter else "llmweb/runtime:0.1.0",
        },
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
    db.commit()
    return {"id": experiment.id, "job_ids": [job.id for job in jobs]}


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


def cloudmcp_identity() -> WebIdentity:
    settings = get_settings()
    return WebIdentity(
        user_id="cloudmcp-operator",
        email="cloudmcp-operator@internal.invalid",
        name="训练助手",
        project_limit=50,
        workspace_id=settings.cloudmcp_operator_workspace_id,
    )


def authenticate_cloudmcp(request: Request) -> None:
    settings = get_settings()
    expected_client_id = settings.cloudmcp_bridge_client_id or ""
    accepted_secrets = [value for value in (
        settings.cloudmcp_bridge_client_secret,
        settings.cloudmcp_bridge_client_secret_next,
    ) if value]
    declared_client_id = request.headers.get("X-CloudMCP-Bridge-Client", "")
    authorization = request.headers.get("Authorization", "")
    configured = bool(expected_client_id and accepted_secrets)
    valid_client = configured and hmac.compare_digest(declared_client_id, expected_client_id)
    valid_secret = any(hmac.compare_digest(authorization, f"Bearer {secret}") for secret in accepted_secrets)
    if not configured:
        raise HTTPException(status_code=500, detail="CloudMCP provider bridge is not configured")
    if not valid_client or not valid_secret:
        raise HTTPException(status_code=401, detail="Unauthorized")


def cloudmcp_state_summary(db: Session, identity: WebIdentity, project_id: str | None = None) -> dict[str, Any]:
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


@app.get("/api/provider-bridge/v1/help", tags=["cloudmcp"])
@app.get("/api/provider-bridge/help", tags=["cloudmcp"])
def cloudmcp_help(request: Request) -> dict[str, Any]:
    return {
        "object": "llmweb_training_provider_bridge_help",
        "provider": {
            "bridgeId": CLOUDMCP_PROVIDER_ID,
            "providerId": CLOUDMCP_PROVIDER_ID,
            "providerName": "LLMWEB Training",
            "routePath": "/api/provider-bridge",
        },
        "auth": {
            "mode": "cloudmcp_provider_env_v1",
            "runtimeHeaders": {
                "Authorization": "Bearer <CLOUDMCP_BRIDGE_CLIENT_SECRET>",
                "X-CloudMCP-Bridge-Client": "<CLOUDMCP_BRIDGE_CLIENT_ID>",
                "X-CloudMCP-Bridge-Provider": CLOUDMCP_PROVIDER_ID,
                "X-CloudMCP-Bridge-Version": CLOUDMCP_PROVIDER_VERSION,
            },
        },
        "protocol": {
            "requestShape": {"tool": "string", "params": {}},
            "successShape": {"success": True, "result": "any"},
            "failureShape": {"success": False, "error": "string"},
        },
        "tools": CLOUDMCP_TOOL_CATALOG,
    }


@app.post("/api/provider-bridge", tags=["cloudmcp"])
async def cloudmcp_provider_bridge(request: Request, db: Db) -> dict[str, Any]:
    authenticate_cloudmcp(request)
    body = await request.json()
    tool = str(body.get("tool") or "").strip()
    params = body.get("params") if isinstance(body.get("params"), dict) else {}
    identity = cloudmcp_identity()
    try:
        if tool == "list_tools":
            result: Any = CLOUDMCP_TOOL_CATALOG
        elif tool == "list_llmweb_training_pool":
            result = cloudmcp_state_summary(db, identity, params.get("project_id"))
        elif tool == "create_llmweb_starter_project":
            result = create_project(ProjectCreate(
                name=params.get("name") or "我的第一次模型训练",
                goal=params.get("goal") or "让一个小模型学会续写莎士比亚风格的文本",
                success_criteria=params.get("success_criteria") or "训练后的测试损失低于训练前",
            ), db, identity)
        elif tool == "create_llmweb_runner_pairing":
            result = create_pairing(db, identity)
        elif tool == "prepare_llmweb_starter_dataset":
            result = create_dataset(DatasetCreate(
                project_id=params.get("project_id", ""), runner_id=params.get("runner_id", ""),
                name="莎士比亚文本练习集", source_type="starter", source_ref="tiny-shakespeare",
                format="txt", train_percent=80, validation_percent=10, test_percent=10, preview_allowed=True,
            ), db, identity)
        elif tool == "start_llmweb_starter_training":
            profile = params.get("profile") or "balanced"
            epochs = {"fast": 1, "balanced": 3, "thorough": 5}.get(profile)
            if epochs is None:
                raise HTTPException(status_code=400, detail="profile 必须是 fast、balanced 或 thorough")
            result = create_experiment(ExperimentCreate(
                project_id=params.get("project_id", ""), runner_id=params.get("runner_id", ""),
                dataset_id=params.get("dataset_id", ""), name=params.get("name") or "第一次入门训练",
                model_id="karpathy/nanoGPT", method="starter", epochs=epochs,
                learning_rate=0.001, max_length=128, batch_size=12, gradient_accumulation=1,
                export_formats=["model"], evaluation_preview_allowed=True,
                output_destination="local", license_confirmed=params.get("license_confirmed") is True,
            ), db, identity)
        elif tool == "get_llmweb_training_run":
            summary = cloudmcp_state_summary(db, identity, params.get("project_id"))
            experiment_id = params.get("experiment_id")
            run = next((item for item in summary["training_runs"] if item["id"] == experiment_id), None)
            if run is None:
                raise HTTPException(status_code=404, detail="训练不存在")
            result = {"training_run": run, "jobs": [item for item in summary["jobs"] if item["experiment_id"] == experiment_id]}
        elif tool == "select_llmweb_training_result":
            experiment_id = str(params.get("experiment_id") or "")
            experiment = db.get(Experiment, experiment_id)
            if experiment is None or experiment.workspace_id != identity.workspace_id:
                raise HTTPException(status_code=404, detail="训练不存在")
            reference = params.get("checkpoint_ref")
            if not reference:
                recommended = next((item for item in experiment.checkpoints or [] if item.get("recommended")), None)
                reference = recommended.get("reference") if recommended else None
            if not reference:
                raise HTTPException(status_code=409, detail="训练还没有可选择的结果")
            result = select_checkpoint(experiment_id, CheckpointSelect(checkpoint_ref=reference), db, identity)
        elif tool == "control_llmweb_training_job":
            result = control_job(str(params.get("job_id") or ""), JobControl(action=params.get("action")), db, identity)
        else:
            raise HTTPException(status_code=404, detail=f"Unknown tool: {tool}")
        return {"success": True, "result": result}
    except HTTPException as error:
        return {"success": False, "error": str(error.detail), "status": error.status_code}
    except (TypeError, ValueError) as error:
        return {"success": False, "error": str(error), "status": 400}
