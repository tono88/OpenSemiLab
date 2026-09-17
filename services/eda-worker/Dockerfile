FROM hpretl/iic-osic-tools:latest

USER root
WORKDIR /opt/opensemilab-worker
COPY worker.py ./worker.py
COPY entrypoint.sh ./entrypoint.sh
RUN chmod 755 ./entrypoint.sh
ENV HOME=/headless \
    USER=designer \
    OPENSEMILAB_WORK_ROOT=/tmp/opensemilab-jobs
EXPOSE 9000
USER 1000:1000
ENTRYPOINT ["/opt/opensemilab-worker/entrypoint.sh"]
