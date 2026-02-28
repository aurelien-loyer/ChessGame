FROM python:3.12-slim

WORKDIR /app

# Install Stockfish engine and PostgreSQL client libs
RUN apt-get update && \
    apt-get install -y --no-install-recommends stockfish libpq-dev && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

COPY web/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY web/ ./

EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:10000/health')"

CMD ["python", "-u", "server.py"]
