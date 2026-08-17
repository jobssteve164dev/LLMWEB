import argparse
from dataclasses import asdict
import json
import math
from pathlib import Path
import random
import shutil

import torch

from model import GPT, GPTConfig


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("task", choices=("baseline", "train", "evaluate", "export", "chat"))
    parser.add_argument("--data", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--checkpoint", default="model.pt")
    parser.add_argument("--iterations", type=int, default=500)
    parser.add_argument("--request")
    return parser.parse_args()


def load_corpus(data_directory: Path):
    texts = {name: (data_directory / f"{name}.txt").read_text(encoding="utf-8") for name in ("train", "validation", "test")}
    vocabulary = sorted(set("".join(texts.values())))
    encode = {character: index for index, character in enumerate(vocabulary)}
    decode = {index: character for character, index in encode.items()}
    tensors = {name: torch.tensor([encode[character] for character in text], dtype=torch.long) for name, text in texts.items()}
    return texts, vocabulary, decode, tensors


def create_model(vocabulary_size: int):
    config = GPTConfig(
        block_size=64,
        vocab_size=vocabulary_size,
        n_layer=4,
        n_head=4,
        n_embd=128,
        dropout=0.0,
        bias=False,
    )
    return GPT(config), config


def get_batch(tensor: torch.Tensor, block_size: int, batch_size: int):
    starts = torch.randint(len(tensor) - block_size - 1, (batch_size,))
    x = torch.stack([tensor[start:start + block_size] for start in starts])
    y = torch.stack([tensor[start + 1:start + block_size + 1] for start in starts])
    return x, y


@torch.no_grad()
def estimate_loss(model: GPT, tensor: torch.Tensor, batches: int = 20):
    model.eval()
    losses = []
    for _ in range(batches):
        x, y = get_batch(tensor, model.config.block_size, 12)
        _, loss = model(x, y)
        losses.append(loss.item())
    model.train()
    return sum(losses) / len(losses)


@torch.no_grad()
def generate_sample(model: GPT, seed_text: str, vocabulary: list[str], decode: dict[int, str]):
    encode = {character: index for index, character in enumerate(vocabulary)}
    prompt = [encode[character] for character in seed_text if character in encode] or [0]
    tokens = torch.tensor(prompt[-model.config.block_size:], dtype=torch.long)[None, :]
    model.eval()
    generated = model.generate(tokens, max_new_tokens=180, temperature=0.8, top_k=min(40, len(vocabulary)))[0].tolist()
    return "".join(decode[index] for index in generated)


def model_size_mb(model: GPT):
    return sum(parameter.numel() * parameter.element_size() for parameter in model.parameters()) / 1024 / 1024


def write_evaluation(directory: Path, model: GPT, test_tensor: torch.Tensor, seed_text: str, vocabulary: list[str], decode: dict[int, str]):
    directory.mkdir(parents=True, exist_ok=True)
    loss = estimate_loss(model, test_tensor)
    metrics = {
        "test_loss": round(loss, 6),
        "perplexity": round(math.exp(min(loss, 20)), 4),
        "model_size_mb": round(model_size_mb(model), 2),
        "test_characters": int(test_tensor.numel()),
    }
    (directory / "metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")
    preview = {
        "instruction": "续写给定文本",
        "input": seed_text,
        "reference": "固定测试集上的真实后续文本",
        "prediction": generate_sample(model, seed_text, vocabulary, decode),
    }
    (directory / "predictions.jsonl").write_text(json.dumps(preview, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"loss": metrics["test_loss"], "perplexity": metrics["perplexity"]}), flush=True)


def load_checkpoint(path: Path):
    payload = torch.load(path, map_location="cpu", weights_only=False)
    config = GPTConfig(**payload["config"])
    model = GPT(config)
    state = payload["model"]
    unwanted_prefix = "_orig_mod."
    for key in list(state):
        if key.startswith(unwanted_prefix):
            state[key[len(unwanted_prefix):]] = state.pop(key)
    model.load_state_dict(state)
    return model


def train(output_directory: Path, tensors: dict[str, torch.Tensor], vocabulary: list[str], iterations: int):
    torch.manual_seed(1337)
    random.seed(1337)
    model, config = create_model(len(vocabulary))
    optimizer = model.configure_optimizers(weight_decay=0.1, learning_rate=1e-3, betas=(0.9, 0.99), device_type="cpu")
    best_loss = float("inf")
    iterations = max(20, min(iterations, 2000))
    for step in range(iterations):
        learning_rate = 1e-3 * 0.5 * (1.0 + math.cos(math.pi * step / iterations))
        for group in optimizer.param_groups:
            group["lr"] = learning_rate
        x, y = get_batch(tensors["train"], config.block_size, 12)
        _, loss = model(x, y)
        optimizer.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optimizer.step()
        should_evaluate = step == 0 or (step + 1) % 100 == 0 or step + 1 == iterations
        if should_evaluate:
            validation_loss = estimate_loss(model, tensors["validation"], batches=10)
            print(json.dumps({
                "loss": round(loss.item(), 6),
                "eval_loss": round(validation_loss, 6),
                "epoch": round((step + 1) / iterations, 4),
                "step": step + 1,
            }), flush=True)
            if validation_loss < best_loss:
                best_loss = validation_loss
                torch.save({"model": model.state_dict(), "config": asdict(config), "step": step + 1, "validation_loss": validation_loss}, output_directory / "model.pt")
    state = {
        "best_model_checkpoint": "model.pt",
        "best_validation_loss": best_loss,
        "iterations": iterations,
    }
    (output_directory / "training_state.json").write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    return best_loss


def main():
    args = parse_args()
    torch.set_num_threads(max(1, min(4, torch.get_num_threads())))
    torch.set_num_interop_threads(1)
    data_directory = Path(args.data)
    output_directory = Path(args.output)
    output_directory.mkdir(parents=True, exist_ok=True)
    texts, vocabulary, decode, tensors = load_corpus(data_directory)
    checkpoint = output_directory / args.checkpoint

    if args.task == "baseline":
        torch.manual_seed(1337)
        model, _ = create_model(len(vocabulary))
        write_evaluation(output_directory / "baseline", model, tensors["test"], texts["test"][:48], vocabulary, decode)
    elif args.task == "train":
        best_loss = train(output_directory, tensors, vocabulary, args.iterations)
        print(json.dumps({"best_validation_loss": round(best_loss, 6)}), flush=True)
    elif args.task == "evaluate":
        model = load_checkpoint(checkpoint)
        write_evaluation(output_directory / "evaluation", model, tensors["test"], texts["test"][:48], vocabulary, decode)
    elif args.task == "export":
        artifact_directory = output_directory / "model"
        artifact_directory.mkdir(parents=True, exist_ok=True)
        shutil.copy2(checkpoint, artifact_directory / "model.pt")
        metadata = {
            "format": "pytorch",
            "architecture": "nanoGPT character model",
            "dataset": "Tiny Shakespeare",
            "vocabulary": vocabulary,
        }
        (artifact_directory / "model.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps({"artifact": "model"}), flush=True)
    else:
        if not args.request:
            raise RuntimeError("对话测试缺少请求文件")
        request = json.loads(Path(args.request).read_text(encoding="utf-8"))
        prompt = str(request.get("prompt", "")).strip()
        if not prompt:
            raise RuntimeError("请输入要测试的内容")
        model = load_checkpoint(checkpoint)
        visible_prompt = "".join(character for character in prompt if character in vocabulary)[-model.config.block_size:]
        generated = generate_sample(model, prompt, vocabulary, decode)
        response = generated[len(visible_prompt):].strip() or generated
        (output_directory / "chat-response.json").write_text(
            json.dumps({"response": response}, ensure_ascii=False), encoding="utf-8"
        )


if __name__ == "__main__":
    main()
