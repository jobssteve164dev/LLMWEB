import argparse
from pathlib import Path
from urllib.parse import urlparse

import boto3


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--destination", required=True)
    parser.add_argument("--formats", required=True)
    parser.add_argument("--checkpoint", default="adapter")
    parser.add_argument("--endpoint")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    destination = urlparse(args.destination)
    if destination.scheme != "s3" or not destination.netloc:
        raise ValueError("S3 目标地址无效")
    client = boto3.client("s3", endpoint_url=args.endpoint)
    source = Path(args.source)
    for artifact_format in args.formats.split(","):
        relative = Path(args.checkpoint) if artifact_format == "adapter" else Path(artifact_format)
        artifact = source / relative
        if not artifact.exists():
            raise FileNotFoundError(f"待上传的 {artifact_format} 产物不存在")
        files = [artifact] if artifact.is_file() else [item for item in artifact.rglob("*") if item.is_file()]
        for file in files:
            suffix = file.name if artifact.is_file() else file.relative_to(artifact).as_posix()
            key = "/".join(part.strip("/") for part in (destination.path, artifact_format, suffix) if part.strip("/"))
            client.upload_file(str(file), destination.netloc, key)


if __name__ == "__main__":
    main()
