FROM python:3.12-slim

ARG OPENMANUS_REPOSITORY=https://github.com/FoundationAgents/OpenManus.git
ARG OPENMANUS_REF=main

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OPENMANUS_HOME=/opt/openmanus

RUN apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 --branch "${OPENMANUS_REF}" "${OPENMANUS_REPOSITORY}" "${OPENMANUS_HOME}"
WORKDIR ${OPENMANUS_HOME}

COPY services/openmanus/requirements-api.txt /tmp/requirements-api.txt
RUN pip install --no-cache-dir -r requirements.txt -r /tmp/requirements-api.txt \
    && python -m playwright install --with-deps chromium

COPY services/openmanus/app.py ${OPENMANUS_HOME}/wes_openmanus_api.py
EXPOSE 8010

CMD ["uvicorn", "wes_openmanus_api:app", "--host", "0.0.0.0", "--port", "8010"]
