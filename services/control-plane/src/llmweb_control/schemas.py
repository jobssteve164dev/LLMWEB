from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    goal: str = Field(min_length=1, max_length=2000)
    success_criteria: str = Field(min_length=1, max_length=2000)


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    goal: str | None = Field(default=None, min_length=1, max_length=2000)
    success_criteria: str | None = Field(default=None, min_length=1, max_length=2000)

    @field_validator("name", "goal", "success_criteria")
    @classmethod
    def normalize_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("项目内容不能为空")
        return normalized

    @model_validator(mode="after")
    def require_change(self):
        if not self.model_fields_set:
            raise ValueError("请至少修改一项项目内容")
        return self


class PairRequest(BaseModel):
    code: str = Field(min_length=4, max_length=64)
    name: str = Field(min_length=1, max_length=120)
    capabilities: dict[str, Any]


class RunnerUpgradeAuthorization(BaseModel):
    code: str = Field(min_length=4, max_length=64)


class HeartbeatRequest(BaseModel):
    capabilities: dict[str, Any]
    active_job_id: str | None = None


class DatasetCreate(BaseModel):
    project_id: str
    runner_id: str
    name: str = Field(min_length=1, max_length=120)
    source_type: Literal["local", "huggingface", "modelscope", "s3", "starter"] = "local"
    source_ref: str = Field(min_length=1, max_length=500)
    format: Literal["json", "jsonl", "csv", "txt", "archive"]
    instruction_field: str = Field(default="instruction", min_length=1, max_length=120)
    input_field: str = Field(default="input", min_length=1, max_length=120)
    output_field: str = Field(default="output", min_length=1, max_length=120)
    train_percent: int = Field(default=80, ge=1, le=98)
    validation_percent: int = Field(default=10, ge=1, le=98)
    test_percent: int = Field(default=10, ge=1, le=98)
    preview_allowed: bool = False

    @field_validator("source_ref")
    @classmethod
    def validate_relative_source(cls, value: str) -> str:
        normalized = value.replace("\\", "/").strip()
        if normalized.startswith("/") or ".." in normalized.split("/"):
            raise ValueError("数据文件必须是算力数据目录内的相对路径")
        return normalized

    @model_validator(mode="after")
    def validate_split(self):
        if self.train_percent + self.validation_percent + self.test_percent != 100:
            raise ValueError("训练集、验证集和测试集比例之和必须为 100")
        if self.source_type == "local" and (self.source_ref.startswith("/") or ".." in self.source_ref.split("/")):
            raise ValueError("本地数据文件必须是算力数据目录内的相对路径")
        if self.source_type == "s3" and not self.source_ref.startswith("s3://"):
            raise ValueError("S3 数据地址必须以 s3:// 开头")
        return self


class ExperimentCreate(BaseModel):
    project_id: str
    runner_id: str
    dataset_id: str
    name: str = Field(min_length=1, max_length=120)
    model_id: str = Field(min_length=1, max_length=300)
    model_revision: str = Field(default="main", min_length=1, max_length=120)
    method: Literal["lora", "qlora", "starter"] = "qlora"
    epochs: float = Field(default=3, gt=0, le=100)
    learning_rate: float = Field(default=0.0002, gt=0, le=1)
    max_length: int = Field(default=2048, ge=128, le=32768)
    batch_size: int = Field(default=1, ge=1, le=128)
    gradient_accumulation: int = Field(default=8, ge=1, le=1024)
    export_formats: list[Literal["adapter", "huggingface", "gguf", "model"]] = ["adapter"]
    evaluation_preview_allowed: bool = False
    output_destination: Literal["local", "user_s3"] = "local"
    output_s3_uri: str | None = Field(default=None, max_length=500)
    output_s3_endpoint: str | None = Field(default=None, max_length=500)
    license_confirmed: bool

    @model_validator(mode="after")
    def validate_output(self):
        if not self.license_confirmed:
            raise ValueError("开始训练前需要确认你有权使用所选模型和数据")
        if self.output_destination == "user_s3" and (not self.output_s3_uri or not self.output_s3_uri.startswith("s3://")):
            raise ValueError("选择 S3 保存时必须填写以 s3:// 开头的目标地址")
        if self.output_s3_endpoint and not self.output_s3_endpoint.startswith(("https://", "http://")):
            raise ValueError("S3 兼容地址必须以 https:// 或 http:// 开头")
        return self


class EventInput(BaseModel):
    event_id: str = Field(min_length=1, max_length=80)
    type: Literal["accepted", "progress", "log", "metric", "completed", "failed", "paused", "cancelled"]
    message: str | None = Field(default=None, max_length=4000)
    payload: dict[str, Any] = {}
    occurred_at: datetime | None = None


class EventBatch(BaseModel):
    lease_id: str
    events: list[EventInput] = Field(min_length=1, max_length=200)


class JobControl(BaseModel):
    action: Literal["pause", "resume", "cancel"]


class CheckpointSelect(BaseModel):
    checkpoint_ref: str = Field(min_length=1, max_length=500)


class ChatCreate(BaseModel):
    prompt: str = Field(min_length=1, max_length=4000)

    @field_validator("prompt")
    @classmethod
    def normalize_prompt(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("请输入要测试的内容")
        return normalized


class ApiConnectionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    purpose: str = Field(min_length=1, max_length=500)
    capabilities: list[Literal["workspace:read", "project:write", "runner:pair", "training:write", "artifact:read"]] = Field(min_length=1)

    @field_validator("capabilities")
    @classmethod
    def deduplicate_capabilities(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(value))


class ApiAuditCreate(BaseModel):
    request_id: str = Field(min_length=1, max_length=80)
    action: str = Field(min_length=1, max_length=120)
    outcome: Literal["succeeded", "failed"]
    target_type: str | None = Field(default=None, max_length=64)
    target_id: str | None = Field(default=None, max_length=64)
    parameter_names: list[str] = Field(default_factory=list, max_length=40)
