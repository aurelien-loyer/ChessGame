FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Le port sera fourni par la variable d'environnement PORT par Render
# (ne pas fixer le port avec EXPOSE dans ce cas)

CMD ["python", "server.py"]
