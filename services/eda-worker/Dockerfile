FROM hpretl/iic-osic-tools:latest

USER root
WORKDIR /opt/opensemilab-worker
COPY worker.py ./worker.py
ENV OPENSEMILAB_WORK_ROOT=/tmp/opensemilab-jobs
EXPOSE 9000
ENTRYPOINT ["python3", "/opt/opensemilab-worker/worker.py"]
