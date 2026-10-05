FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends libblas3 liblapack3 && rm -rf /var/lib/apt/lists/*
WORKDIR /worker
COPY pyproject.toml ./
COPY src ./src
RUN pip install --no-cache-dir .
ENV DEVSIM_MATH_LIBS=liblapack.so.3:libblas.so.3
EXPOSE 8787
CMD ["opensemilab-devsim"]
