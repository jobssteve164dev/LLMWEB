import argparse
import json
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-type", choices=["huggingface", "modelscope", "s3"], required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--format", choices=["json", "jsonl", "csv"], default="jsonl")
    parser.add_argument("--output", required=True)
    return parser.parse_args()


def split_reference(reference: str) -> tuple[str, str | None, str | None]:
    parts = reference.split("::", 2)
    return parts[0], parts[1] if len(parts) > 1 and parts[1] else None, parts[2] if len(parts) > 2 and parts[2] else None


def load_rows(args: argparse.Namespace):
    name, configuration, split = split_reference(args.source)
    if args.source_type == "huggingface":
        from datasets import DatasetDict, load_dataset

        dataset = load_dataset(name, configuration, split=split) if split else load_dataset(name, configuration)
        if isinstance(dataset, DatasetDict):
            dataset = dataset["train"] if "train" in dataset else dataset[next(iter(dataset.keys()))]
        return dataset
    if args.source_type == "modelscope":
        from modelscope.msdatasets import MsDataset

        dataset = MsDataset.load(name, subset_name=configuration, split=split or "train")
        return dataset.to_hf_dataset() if hasattr(dataset, "to_hf_dataset") else dataset

    from datasets import load_dataset

    loader = "csv" if args.format == "csv" else "json"
    return load_dataset(loader, data_files=args.source, split="train")


def main() -> None:
    args = parse_args()
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    rows = load_rows(args)
    with output.open("w", encoding="utf-8") as file:
        for row in rows:
            file.write(json.dumps(dict(row), ensure_ascii=False, default=str) + "\n")


if __name__ == "__main__":
    main()
