from contextlib import asynccontextmanager
from datetime import timedelta, timezone
import secrets
from typing import Annotated, Any

from fastapi import Depends, FastAPI, Header, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .database import Base, engine, get_db
from .models import Dataset, Experiment, Job, JobEvent, PairingCode, Project, Runner, Workspace, new_id, utc_now
from .schemas import CheckpointSelect, DatasetCreate, EventBatch, ExperimentCreate, HeartbeatRequest, JobControl, PairRequest, ProjectCreate
from .security import digest_secret, require_runner, require_web
from .settings import get_settings

Db = Annotated[Session, Depends(get_db)]
WebAuth = Annotated[None, Depends(require_web)]
DEFAULT_WORKSPACE_ID = "ws_default"
APPROVED_MODELS = {
    "Qwen/Qwen2.5-0.5B-Instruct": "7ae557604adf67be50417f59c2c2f167def9a775",
    "Qwen/Qwen2.5-1.5B-Instruct": "989aa7980e4cf806f80c7fef2b1adb7bc71aa306",
    "Qwen/Qwen2.5-3B-Instruct": "aa8e72537993ba99e69dfaafa59ed015b17504d1",
}


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


@app.get("/v1/state", dependencies=[Depends(require_web)], tags=["web"])
def state(db: Db) -> dict[str, Any]:
    projects = list(db.scalars(select(Project).where(Project.workspace_id == DEFAULT_WORKSPACE_ID).order_by(Project.created_at)))
    runners = list(db.scalars(select(Runner).where(Runner.workspace_id == DEFAULT_WORKSPACE_ID).order_by(Runner.created_at)))
    datasets = list(db.scalars(select(Dataset).where(Dataset.workspace_id == DEFAULT_WORKSPACE_ID).order_by(Dataset.created_at.desc())))
    experiments = list(db.scalars(select(Experiment).where(Experiment.workspace_id == DEFAULT_WORKSPACE_ID).order_by(Experiment.created_at.desc())))
    jobs = list(db.scalars(select(Job).where(Job.workspace_id == DEFAULT_WORKSPACE_ID).order_by(Job.created_at.desc())))
    recent_events = list(db.scalars(select(JobEvent).order_by(JobEvent.id.desc()).limit(200)))
    events_by_job: dict[str, list[JobEvent]] = {}
    for event in reversed(recent_events):
        events_by_job.setdefault(event.job_id, []).append(event)

    return {
        "workspace": {"id": DEFAULT_WORKSPACE_ID, "name": "我的工作区"},
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


@app.post("/v1/projects", status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_web)], tags=["web"])
def create_project(body: ProjectCreate, db: Db) -> dict[str, str]:
    project = Project(workspace_id=DEFAULT_WORKSPACE_ID, **body.model_dump())
    db.add(project)
    db.commit()
    return {"id": project.id}


@app.post("/v1/runners/pairing", status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_web)], tags=["web"])
def create_pairing(db: Db) -> dict[str, Any]:
    settings = get_settings()
    code = secrets.token_urlsafe(6).upper().replace("-", "")[:8]
    pairing = PairingCode(
        workspace_id=DEFAULT_WORKSPACE_ID,
        code_hash=digest_secret(code),
        expires_at=utc_now() + timedelta(minutes=settings.pairing_ttl_minutes),
    )
    db.add(pairing)
    db.commit()
    return {
        "code": code,
        "expires_at": as_iso(pairing.expires_at),
        "command": f"./runner/bin/llmweb-runner connect --url {settings.public_url} --code {code} --data-root /path/to/data --output-root /path/to/output",
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


@app.post("/v1/datasets", status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_web)], tags=["web"])
def create_dataset(body: DatasetCreate, db: Db) -> dict[str, str]:
    project = db.get(Project, body.project_id)
    runner = db.get(Runner, body.runner_id)
    if project is None or project.workspace_id != DEFAULT_WORKSPACE_ID:
        raise HTTPException(status_code=404, detail="项目不存在")
    if runner is None or runner.workspace_id != DEFAULT_WORKSPACE_ID or runner.revoked:
        raise HTTPException(status_code=404, detail="算力连接不存在")
    dataset = Dataset(
        workspace_id=DEFAULT_WORKSPACE_ID,
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
        workspace_id=DEFAULT_WORKSPACE_ID,
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


@app.post("/v1/experiments", status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_web)], tags=["web"])
def create_experiment(body: ExperimentCreate, db: Db) -> dict[str, Any]:
    project = db.get(Project, body.project_id)
    runner = db.get(Runner, body.runner_id)
    dataset = db.get(Dataset, body.dataset_id)
    if project is None or runner is None or dataset is None:
        raise HTTPException(status_code=404, detail="项目、数据或算力连接不存在")
    if dataset.status != "ready":
        raise HTTPException(status_code=409, detail="请等待数据检查完成后再开始训练")
    if dataset.project_id != project.id or dataset.runner_id != runner.id:
        raise HTTPException(status_code=400, detail="项目、数据和算力连接不属于同一训练流程")
    revision = APPROVED_MODELS.get(body.model_id)
    if revision is None:
        raise HTTPException(status_code=400, detail="首版只支持工作台中列出的 Qwen 2.5 指令模型")

    model = {"source": "huggingface", "id": body.model_id, "revision": revision, "template": infer_template(body.model_id)}
    training = {
        "method": body.method,
        "epochs": body.epochs,
        "learning_rate": body.learning_rate,
        "max_length": body.max_length,
        "batch_size": body.batch_size,
        "gradient_accumulation": body.gradient_accumulation,
    }
    experiment = Experiment(
        workspace_id=DEFAULT_WORKSPACE_ID,
        project_id=project.id,
        runner_id=runner.id,
        dataset_id=dataset.id,
        name=body.name,
        model=model,
        training=training,
        export_formats=list(dict.fromkeys(body.export_formats)),
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
        "workspace_id": DEFAULT_WORKSPACE_ID,
        "project_id": project.id,
        "experiment_id": experiment.id,
        "dataset_id": dataset.id,
        "model": model,
        "training": training,
        "runtime": {"engine": "llamafactory", "image": "llmweb/runtime:0.1.0"},
    }
    jobs = []
    for sequence, kind in enumerate(("baseline", "train", "evaluate", "export")):
        payload = {**common, "task": kind, "output": {"formats": experiment.export_formats, "preview_allowed": experiment.evaluation_preview_allowed, "destination": experiment.output_destination, "s3_uri": experiment.output_s3_uri, "s3_endpoint": experiment.output_s3_endpoint}}
        job = Job(
            workspace_id=DEFAULT_WORKSPACE_ID,
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


@app.post("/v1/experiments/{experiment_id}/select-checkpoint", dependencies=[Depends(require_web)], tags=["web"])
def select_checkpoint(experiment_id: str, body: CheckpointSelect, db: Db) -> dict[str, str]:
    experiment = db.get(Experiment, experiment_id)
    if experiment is None or experiment.workspace_id != DEFAULT_WORKSPACE_ID:
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


@app.post("/v1/jobs/{job_id}/control", dependencies=[Depends(require_web)], tags=["web"])
def control_job(job_id: str, body: JobControl, db: Db) -> dict[str, str]:
    job = db.get(Job, job_id)
    if job is None or job.workspace_id != DEFAULT_WORKSPACE_ID:
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
