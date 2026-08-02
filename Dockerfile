FROM python:3.11-slim

WORKDIR /app

# Dependencias del sistema para xgboost
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 && rm -rf /var/lib/apt/lists/*

COPY api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiamos API + training (la API importa features del script de entrenamiento)
COPY api/ ./ 
COPY training/ ../training/

EXPOSE 8000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
