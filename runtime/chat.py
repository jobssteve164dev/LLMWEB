import argparse
import json
from pathlib import Path

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--adapter", required=True)
    parser.add_argument("--quantization", choices=["4"])
    return parser.parse_args()


def main():
    args = parse_args()
    request = json.loads(Path(args.request).read_text(encoding="utf-8"))
    prompt = str(request.get("prompt", "")).strip()
    max_new_tokens = max(16, min(int(request.get("max_new_tokens", 256)), 512))
    if not prompt:
        raise RuntimeError("请输入要测试的内容")

    tokenizer = AutoTokenizer.from_pretrained(args.model, revision=args.revision, trust_remote_code=False)
    device_type = "mps" if torch.backends.mps.is_available() else "cuda" if torch.cuda.is_available() else "cpu"
    model_kwargs = {
        "revision": args.revision,
        "trust_remote_code": False,
        "device_map": device_type if device_type == "mps" else "auto",
        "torch_dtype": "auto",
    }
    if args.quantization == "4":
        model_kwargs["quantization_config"] = BitsAndBytesConfig(load_in_4bit=True)
    model = AutoModelForCausalLM.from_pretrained(args.model, **model_kwargs)
    model = PeftModel.from_pretrained(model, args.adapter)
    model.eval()
    rendered = tokenizer.apply_chat_template(
        [{"role": "user", "content": prompt}], tokenize=False, add_generation_prompt=True
    )
    context_limit = int(getattr(model.config, "max_position_embeddings", 2048))
    encoded = tokenizer(rendered, return_tensors="pt", truncation=True, max_length=max(128, context_limit - max_new_tokens))
    encoded = {key: value.to(model.device) for key, value in encoded.items()}
    with torch.inference_mode():
        output = model.generate(
            **encoded,
            max_new_tokens=max_new_tokens,
            do_sample=False,
            pad_token_id=tokenizer.eos_token_id,
        )
    new_tokens = output[0, encoded["input_ids"].shape[1]:]
    response = tokenizer.decode(new_tokens, skip_special_tokens=True).strip()
    Path(args.output).write_text(json.dumps({"response": response}, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
