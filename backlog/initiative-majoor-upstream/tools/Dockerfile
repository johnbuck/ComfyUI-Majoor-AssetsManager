FROM node:24-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv python3-pip exiftool ffmpeg && rm -rf /var/lib/apt/lists/*
COPY requirements.txt requirements-dev.txt /tmp/req/
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install -q --upgrade pip && /opt/venv/bin/pip install -q -r /tmp/req/requirements-dev.txt
ENV PATH=/opt/venv/bin:$PATH
RUN git config --system --add safe.directory '*'
WORKDIR /work
