FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# OpenCV's Linux wheel needs its XCB runtime library even in a headless service.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libxcb1 \
        libglib2.0-0 \
        libgl1 \
        libsm6 \
        libxext6 \
        libxrender1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN python -m pip install --no-cache-dir -r requirements.txt

COPY . .

ENV HOST=0.0.0.0
CMD ["python", "serve.py"]
