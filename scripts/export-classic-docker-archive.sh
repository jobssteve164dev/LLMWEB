#!/usr/bin/env bash
set -Eeuo pipefail

IMAGE="${1:-}"
OUTPUT="${2:-}"
[[ "$IMAGE" =~ ^[A-Za-z0-9._/-]+:[A-Za-z0-9._-]+$ ]] || { echo "invalid image reference" >&2; exit 2; }
[[ -n "$OUTPUT" ]] || { echo "output path is required" >&2; exit 2; }
command -v skopeo >/dev/null 2>&1 || { echo "skopeo is required" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq is required" >&2; exit 1; }

TASK_TEMP_ROOT="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
WORK_ROOT="$(mktemp -d "$TASK_TEMP_ROOT/llmweb-classic-archive.XXXXXX")"
SKOPEO_ARCHIVE="$WORK_ROOT/skopeo.tar"
SOURCE_LAYOUT="$WORK_ROOT/source"
CLASSIC_LAYOUT="$WORK_ROOT/classic"
RAW_ARCHIVE="$WORK_ROOT/image.tar"
mkdir -p "$SOURCE_LAYOUT" "$CLASSIC_LAYOUT"

SKOPEO_DAEMON_HOST="${DOCKER_HOST:-unix:///var/run/docker.sock}"
if [[ "$SKOPEO_DAEMON_HOST" == tcp://* ]]; then
  SKOPEO_DAEMON_HOST="http://${SKOPEO_DAEMON_HOST#tcp://}"
fi
skopeo copy --src-daemon-host "$SKOPEO_DAEMON_HOST" \
  "docker-daemon:$IMAGE" "docker-archive:$SKOPEO_ARCHIVE:$IMAGE"
tar -xf "$SKOPEO_ARCHIVE" -C "$SOURCE_LAYOUT"

mapfile -t ORIGINAL_LAYERS < <(jq -r '.[0].Layers[]' "$SOURCE_LAYOUT/manifest.json")
(( ${#ORIGINAL_LAYERS[@]} > 0 )) || { echo "image archive has no layers" >&2; exit 1; }
CLASSIC_LAYER_PATHS=()
for layer_file in "${ORIGINAL_LAYERS[@]}"; do
  layer_dir="$(find "$SOURCE_LAYOUT" -mindepth 2 -maxdepth 2 -type l -name layer.tar -lname "../$layer_file" -printf '%h\n' -quit)"
  [[ -n "$layer_dir" ]] || { echo "unable to resolve classic layer for $layer_file" >&2; exit 1; }
  layer_dir="${layer_dir#"$SOURCE_LAYOUT/"}"
  mkdir -p "$CLASSIC_LAYOUT/$layer_dir"
  cp "$SOURCE_LAYOUT/$layer_file" "$CLASSIC_LAYOUT/$layer_dir/layer.tar"
  CLASSIC_LAYER_PATHS+=("$layer_dir/layer.tar")
done

CLASSIC_LAYERS_JSON="$(printf '%s\n' "${CLASSIC_LAYER_PATHS[@]}" | jq -R . | jq -s .)"
jq --argjson layers "$CLASSIC_LAYERS_JSON" --arg image "$IMAGE" \
  '.[0].Layers = $layers | .[0].RepoTags = [$image]' \
  "$SOURCE_LAYOUT/manifest.json" > "$CLASSIC_LAYOUT/manifest.json"
cp "$SOURCE_LAYOUT/repositories" "$CLASSIC_LAYOUT/repositories"
CONFIG_FILE="$(jq -r '.[0].Config' "$CLASSIC_LAYOUT/manifest.json")"
[[ "$CONFIG_FILE" == "$(basename "$CONFIG_FILE")" && -f "$SOURCE_LAYOUT/$CONFIG_FILE" ]] \
  || { echo "image config is invalid" >&2; exit 1; }
cp "$SOURCE_LAYOUT/$CONFIG_FILE" "$CLASSIC_LAYOUT/$CONFIG_FILE"

tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner \
  -cf "$RAW_ARCHIVE" -C "$CLASSIC_LAYOUT" \
  manifest.json repositories "$CONFIG_FILE" "${CLASSIC_LAYER_PATHS[@]%/layer.tar}"
gzip -nc "$RAW_ARCHIVE" > "$OUTPUT"

ARCHIVE_LIST="$WORK_ROOT/archive-files.txt"
tar -tzf "$OUTPUT" > "$ARCHIVE_LIST"
grep -Fxq "manifest.json" "$ARCHIVE_LIST"
grep -Fxq "repositories" "$ARCHIVE_LIST"
grep -Eq '^[^/]+/layer\.tar$' "$ARCHIVE_LIST"
tar -tvzf "$OUTPUT" | awk \
  '$1 ~ /^-/ && $NF ~ /\/layer\.tar$/ {regular++} $1 ~ /^l/ && $NF ~ /\/layer\.tar$/ {links++} END {exit !(regular > 0 && links == 0)}'
tar -xOzf "$OUTPUT" manifest.json | jq -e --arg image "$IMAGE" \
  'length == 1 and .[0].RepoTags == [$image] and (.[] | .Layers | length > 0 and all(endswith("/layer.tar")))' >/dev/null
