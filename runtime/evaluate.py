import argparse
import json
import time
from pathlib import Path

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig, StoppingCriteria, StoppingCriteriaList


class FirstTokenClock(StoppingCriteria):
    def __init__(self) -> None:
        self.first_token_at: float | None = None

    def __call__(self, input_ids, scores, **kwargs) -> bool:
        if self.first_token_at is None:
            self.first_token_at = time.perf_counter()
        return False


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--data", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--adapter")
    parser.add_argument("--quantization", choices=["4"])
    return parser.parse_args()


def format_pass(prediction: str, reference: str) -> bool:
    if not prediction.strip():
        return False
    if reference.lstrip().startswith(("{", "[")):
        try:
            json.loads(prediction)
        except json.JSONDecodeError:
            return False
    return True


def synchronize_device(device_type: str) -> None:
    if device_type == "cuda":
        torch.cuda.synchronize()
    elif device_type == "mps":
        torch.mps.synchronize()


def main() -> None:
    args = parse_args()
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)
    rows = json.loads(Path(args.data).read_text(encoding="utf-8"))
    if not rows:
        raise RuntimeError("测试集为空，无法完成效果比较")

    tokenizer = AutoTokenizer.from_pretrained(args.model, revision=args.revision, trust_remote_code=False)
    device_type = "mps" if torch.backends.mps.is_available() else "cuda" if torch.cuda.is_available() else "cpu"
    if args.quantization == "4" and device_type == "mps":
        raise RuntimeError("Apple Silicon 当前使用 LoRA；4 位 QLoRA 需要 CUDA 量化后端")
    model_kwargs = {
        "revision": args.revision,
        "trust_remote_code": False,
        "device_map": device_type if device_type == "mps" else "auto",
        "torch_dtype": "auto",
    }
    if args.quantization == "4":
        model_kwargs["quantization_config"] = BitsAndBytesConfig(load_in_4bit=True)
    model = AutoModelForCausalLM.from_pretrained(args.model, **model_kwargs)
    if args.adapter:
        model = PeftModel.from_pretrained(model, args.adapter)
    model.eval()

    predictions = []
    exact = 0
    valid_format = 0
    first_token_latencies = []
    generated_tokens = 0
    generation_seconds = 0.0
    peak_memory = 0.0
    if torch.cuda.is_available():
        torch.cuda.reset_peak_memory_stats()

    for row in rows:
        instruction = str(row.get("instruction", "")).strip()
        extra_input = str(row.get("input", "")).strip()
        reference = str(row.get("output", "")).strip()
        content = instruction if not extra_input else f"{instruction}\n\n{extra_input}"
        prompt = tokenizer.apply_chat_template(
            [{"role": "user", "content": content}], tokenize=False, add_generation_prompt=True
        )
        encoded = tokenizer(prompt, return_tensors="pt")
        encoded = {key: value.to(model.device) for key, value in encoded.items()}
        reference_tokens = len(tokenizer.encode(reference, add_special_tokens=False))
        clock = FirstTokenClock()
        synchronize_device(device_type)
        started = time.perf_counter()
        with torch.inference_mode():
            output = model.generate(
                **encoded,
                max_new_tokens=max(64, min(512, reference_tokens * 2 + 16)),
                do_sample=False,
                stopping_criteria=StoppingCriteriaList([clock]),
                pad_token_id=tokenizer.eos_token_id,
            )
        synchronize_device(device_type)
        finished = time.perf_counter()
        new_tokens = output[0, encoded["input_ids"].shape[1]:]
        prediction = tokenizer.decode(new_tokens, skip_special_tokens=True).strip()
        latency = (clock.first_token_at or finished) - started
        first_token_latencies.append(latency)
        generation_seconds += max(finished - (clock.first_token_at or started), 1e-6)
        generated_tokens += int(new_tokens.shape[0])
        if prediction == reference:
            exact += 1
        if format_pass(prediction, reference):
            valid_format += 1
        if device_type == "mps":
            peak_memory = max(peak_memory, float(torch.mps.current_allocated_memory()))
        predictions.append({"instruction": instruction, "input": extra_input, "reference": reference, "prediction": prediction})

    if device_type == "cuda":
        peak_memory = float(torch.cuda.max_memory_allocated())
    peak_memory /= 1024 * 1024
    model_bytes = sum(parameter.numel() * parameter.element_size() for parameter in model.parameters())
    metrics = {
        "samples": len(predictions),
        "exact_match": exact / len(predictions),
        "format_pass_rate": valid_format / len(predictions),
        "first_token_latency_ms": sum(first_token_latencies) * 1000 / len(first_token_latencies),
        "tokens_per_second": generated_tokens / generation_seconds,
        "peak_gpu_memory_mb": peak_memory,
        "model_size_mb": model_bytes / (1024 * 1024),
    }
    (output_dir / "metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")
    with (output_dir / "predictions.jsonl").open("w", encoding="utf-8") as file:
        for prediction in predictions:
            file.write(json.dumps(prediction, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
