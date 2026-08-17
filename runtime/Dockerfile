ARG BASE_IMAGE=hiyouga/pytorch:th2.6.0-cu124-flashattn2.7.4-cxx11abi0-devel
FROM ${BASE_IMAGE}

ARG LLAMA_FACTORY_REF=95ac3f2373b82662c1bd855c284d3379e6a763d3
ARG LLAMA_CPP_REF=4ed2b13f758ea467282cf0b0e1a938fca7f51211
ARG PIP_INDEX=https://pypi.org/simple

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_ROOT_USER_ACTION=ignore \
    VLLM_WORKER_MULTIPROC_METHOD=spawn

COPY runtime/requirements.txt /opt/llmweb/requirements.txt

RUN apt-get update \
    && apt-get install --yes --no-install-recommends git ca-certificates \
    && git clone --filter=blob:none https://github.com/hiyouga/LlamaFactory.git /opt/llamafactory \
    && git -C /opt/llamafactory checkout "${LLAMA_FACTORY_REF}" \
    && pip install --no-cache-dir --index-url "${PIP_INDEX}" --upgrade pip packaging wheel setuptools editables "hatchling>=1.18.0" \
    && pip install --no-cache-dir --index-url "${PIP_INDEX}" --no-build-isolation -e /opt/llamafactory \
    && pip install --no-cache-dir --index-url "${PIP_INDEX}" --no-build-isolation -r /opt/llamafactory/requirements/metrics.txt \
    && pip install --no-cache-dir --index-url "${PIP_INDEX}" -r /opt/llmweb/requirements.txt \
    && git clone --filter=blob:none https://github.com/ggerganov/llama.cpp.git /opt/llama.cpp \
    && git -C /opt/llama.cpp checkout "${LLAMA_CPP_REF}" \
    && pip install --no-cache-dir --index-url "${PIP_INDEX}" -r /opt/llama.cpp/requirements/requirements-convert_hf_to_gguf.txt \
    && apt-get clean

COPY runtime/evaluate.py /opt/llmweb/evaluate.py
COPY runtime/chat.py /opt/llmweb/chat.py
COPY runtime/prepare_dataset.py /opt/llmweb/prepare_dataset.py
COPY runtime/upload_artifacts.py /opt/llmweb/upload_artifacts.py
WORKDIR /workspace
