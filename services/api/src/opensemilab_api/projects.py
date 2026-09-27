"""Proyectos por usuario (modelo abierto estilo Tinkercad) + eventos de diseño.

- GET /projects → solo los míos.
- GET /projects/gallery → todos (cualquier logueado puede ver/clonar).
- POST /projects → crea; si trae id de un proyecto mío, lo actualiza (sync).
- PUT /projects/{pid} → actualiza uno mío.
- DELETE /projects/{pid} → borra uno mío (admin puede cualquiera vía /admin).
- POST /events → telemetría mínima {project_id, tool, action, payload}.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from opensemilab_api.auth import get_current_user
from opensemilab_api.db import get_db
from opensemilab_api.models_db import DesignEvent, Project, User

router = APIRouter(prefix="/api/v1", tags=["projects"])


class ProjectIn(BaseModel):
    id: str | None = Field(default=None, max_length=64)
    name: str = Field(min_length=1, max_length=160)
    data: dict = Field(default_factory=dict)


class EventIn(BaseModel):
    project_id: str = Field(default="", max_length=64)
    tool: str = Field(default="", max_length=64)
    action: str = Field(default="", max_length=64)
    payload: dict = Field(default_factory=dict)


def _out(project: Project, owner_email: str = "") -> dict:
    return {
        "id": project.id,
        "owner_id": project.owner_id,
        "owner_email": owner_email,
        "name": project.name,
        "data": project.data,
        "updated_at": project.updated_at.isoformat() if project.updated_at else "",
    }


def _owned(db: Session, pid: str, user: User) -> Project:
    project = db.get(Project, pid)
    if project is None or project.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")
    return project


@router.get("/projects")
def my_projects(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[dict]:
    rows = db.query(Project).filter_by(owner_id=user.id).order_by(Project.updated_at.desc()).all()
    return [_out(p, user.email) for p in rows]


@router.get("/projects/gallery")
def gallery(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[dict]:
    rows = db.query(Project).order_by(Project.updated_at.desc()).limit(200).all()
    owners = {u.id: u.email for u in db.query(User).filter(User.id.in_([p.owner_id for p in rows])).all()}
    return [_out(p, owners.get(p.owner_id, "")) for p in rows]


@router.post("/projects", status_code=201)
def save_project(
    body: ProjectIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> dict:
    if body.id:
        existing = db.get(Project, body.id)
        if existing is not None:
            if existing.owner_id != user.id:
                raise HTTPException(status_code=403, detail="No es tu proyecto (clónalo primero)")
            existing.name = body.name
            existing.data = body.data
            db.commit()
            db.refresh(existing)
            return _out(existing, user.email)
    project = Project(owner_id=user.id, name=body.name, data=body.data)
    db.add(project)
    db.commit()
    db.refresh(project)
    return _out(project, user.email)


@router.put("/projects/{pid}")
def update_project(
    pid: str, body: ProjectIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> dict:
    project = _owned(db, pid, user)
    project.name = body.name
    project.data = body.data
    db.commit()
    db.refresh(project)
    return _out(project, user.email)


@router.delete("/projects/{pid}", status_code=204)
def delete_project(
    pid: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> None:
    project = _owned(db, pid, user)
    db.delete(project)
    db.commit()


@router.post("/events", status_code=202)
def track_event(
    body: EventIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> dict:
    db.add(
        DesignEvent(
            user_id=user.id,
            project_id=body.project_id[:64],
            tool=body.tool[:64],
            action=body.action[:64],
            payload=body.payload,
        )
    )
    db.commit()
    return {"ok": True}
