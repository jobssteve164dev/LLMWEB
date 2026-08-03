FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY services/control-plane /app/services/control-plane
RUN python -m pip install --no-cache-dir /app/services/control-plane

CMD ["uvicorn", "llmweb_control.main:app", "--host", "0.0.0.0", "--port", "8000"]
