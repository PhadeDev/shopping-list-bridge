FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SHOPPING_LIST_DATA_DIR=/app/data

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
COPY templates ./templates
COPY static ./static

RUN mkdir -p /app/data

EXPOSE 5057
CMD ["gunicorn", "--bind", "0.0.0.0:5057", "--workers", "2", "--threads", "2", "--timeout", "30", "app:app"]
