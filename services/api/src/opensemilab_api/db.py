"""Postgres connection + session helpers.

En local/dev sin DATABASE_URL cae a SQLite para que `pytest` siga
funcionando sin Docker. En compose/LAB usa Postgres (ver docker-compose.yml).
Tu pgAdmin local apunta a localhost:5432 con user/pass del compose.
"""

import os

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    # SQLite de dev junto al código (ruta absoluta): seed, server y tests
    # siempre usan el mismo archivo sin importar desde dónde se corran.
    _here = os.path.dirname(os.path.abspath(__file__)).replace(os.sep, "/")
    DATABASE_URL = f"sqlite:///{_here}/opensemilab-dev.db"
_connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, pool_pre_ping=True, connect_args=_connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    # Importa modelos para registrar tablas antes de create_all.
    from opensemilab_api import models_db  # noqa: F401

    Base.metadata.create_all(bind=engine)
