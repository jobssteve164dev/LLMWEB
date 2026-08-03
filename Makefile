.PHONY: web-service gpu-runtime verify

web-service:
	docker compose -f compose.yaml -f compose.local.yaml up --build

gpu-runtime:
	cd runner && mkdir -p bin && go build -o bin/llmweb-runner ./cmd/runner
	docker build -t llmweb/runtime:0.1.0 -f runtime/Dockerfile .

verify:
	pnpm check
	.venv/bin/python -m pytest services/control-plane
	cd runner && go test ./... && go vet ./...
