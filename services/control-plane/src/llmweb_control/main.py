from fastapi import FastAPI

app = FastAPI(
    title="LLMWEB Control Plane",
    description="Coordinates projects, runners, training jobs, evaluations, and model records.",
    version="0.1.0",
)


@app.get("/health", tags=["system"])
def health() -> dict[str, str]:
    return {"service": "llmweb-control-plane", "status": "healthy"}
