from typing import Any


PLAN_VERSION = "1.0"

PARAMETER_CAPABILITIES = {
    "epochs": {"minimum": 0.1, "maximum": 100, "suggested_step": 0.1},
    "learning_rate": {"minimum": 1e-7, "maximum": 1.0, "suggested_step": 1e-5},
    "max_length": {"minimum": 128, "maximum": 32768, "suggested_step": 128},
    "batch_size": {"minimum": 1, "maximum": 128, "suggested_step": 1},
    "gradient_accumulation": {"minimum": 1, "maximum": 1024, "suggested_step": 1},
}

ACCELERATED_OPERATORS = {
    "lr_scheduler": {"value": "cosine", "editable": False},
    "warmup_ratio": {"value": 0.1, "editable": False},
    "evaluation": {"value": "epoch", "editable": False},
    "checkpoint": {"value": "epoch", "editable": False},
    "precision": {"value": "fp16", "editable": False},
}

CPU_STARTER_OPERATORS = {
    "lr_scheduler": {"value": "cosine", "editable": False},
    "evaluation": {"value": "every_100_steps", "editable": False},
    "checkpoint": {"value": "best_validation", "editable": False},
    "precision": {"value": "fp32", "editable": False},
    "gradient_clip": {"value": 1.0, "editable": False},
}

SUPPORTED_BACKENDS = {"docker_cuda", "native_mps", "docker_cpu"}
REQUIRED_TRAINING_TASKS = {"baseline", "train", "evaluate", "export"}


class TrainingPlanError(ValueError):
    pass


def resolve_training_plan(capabilities: dict[str, Any], configuration: Any) -> dict[str, Any]:
    backend = capabilities.get("backend")
    if capabilities.get("ready") is not True:
        raise TrainingPlanError("这台算力尚未准备好训练")
    if not isinstance(backend, str) or backend not in SUPPORTED_BACKENDS:
        raise TrainingPlanError("这台算力暂不支持当前训练环境，请重新检查连接")
    supported_tasks = capabilities.get("supported_tasks")
    if not isinstance(supported_tasks, list) or not REQUIRED_TRAINING_TASKS.issubset(supported_tasks):
        raise TrainingPlanError("这台算力尚未提供完整训练能力，请更新或重新检查连接")

    method = configuration.method
    if backend == "docker_cpu" and method != "starter":
        raise TrainingPlanError("这台普通电脑使用入门训练方案；模型和训练设置会由系统自动匹配")
    if backend != "docker_cpu" and method == "starter":
        raise TrainingPlanError("入门训练方案需要选择普通 CPU 算力")
    if backend == "native_mps" and method == "qlora":
        raise TrainingPlanError("Apple Silicon 当前使用 Metal/MPS LoRA；4 位 QLoRA 需要 CUDA 量化后端")

    resolved = {
        "method": method,
        "epochs": configuration.epochs,
        "learning_rate": configuration.learning_rate,
        "max_length": configuration.max_length,
        "batch_size": configuration.batch_size,
        "gradient_accumulation": configuration.gradient_accumulation,
    }
    if backend == "docker_cpu":
        resolved.update({"learning_rate": 0.001, "max_length": 128, "batch_size": 12, "gradient_accumulation": 1})
    effective_batch_size = resolved["batch_size"] * resolved["gradient_accumulation"]
    warnings = []
    if effective_batch_size > 128:
        warnings.append("large_effective_batch")
    if resolved["max_length"] >= 8192:
        warnings.append("long_context")

    return {
        "plan_version": PLAN_VERSION,
        "backend": backend,
        "editable": backend != "docker_cpu",
        "parameters": {key: dict(value) for key, value in PARAMETER_CAPABILITIES.items()},
        "resolved": resolved,
        "derived": {"effective_batch_size": effective_batch_size},
        "operators": {
            key: dict(value)
            for key, value in (CPU_STARTER_OPERATORS if backend == "docker_cpu" else ACCELERATED_OPERATORS).items()
        },
        "warnings": warnings,
    }
