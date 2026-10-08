"""Panel admin: solo Estuardo y André (role=admin).

- GET /admin/users → usuarios + estado.
- PATCH /admin/users/{uid} {is_active?, role?} → aprobar/desactivar, dar/quitar admin.
  (No puedes tocarte a ti mismo.)
- GET /admin/projects → todos con dueño.
- DELETE /admin/projects/{pid} → borra cualquiera.
- GET /admin/events?tool=&action=&limit= → telemetría con dueño.
- GET /admin/stats → conteos + agregados por herramienta/acción.
"""

from fastapi import APIRouter, Depends, HTTPException
import smtplib
from typing import Literal

from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from opensemilab_api.auth import require_admin
from opensemilab_api.db import get_db
from opensemilab_api.models_db import DesignEvent, Project, SmtpSettings, User
from opensemilab_api.smtp_service import encrypt_password, get_settings, send_email, smtp_public

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


class UserPatch(BaseModel):
    is_active: bool | None = None
    role: str | None = None


class SmtpSettingsIn(BaseModel):
    enabled: bool = False
    host: str = Field(default="", max_length=255)
    port: int = Field(default=587, ge=1, le=65535)
    encryption: str = "starttls"
    username: str = Field(default="", max_length=320)
    password: str | None = Field(default=None, max_length=512)
    clear_password: bool = False
    from_email: EmailStr | Literal[""] = ""
    from_name: str = Field(default="OpenSemiLab", max_length=160)


class SmtpTestIn(BaseModel):
    recipient: EmailStr | None = None


def _user_out(user: User) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "role": user.role,
        "is_active": user.is_active,
        "is_verified": user.is_verified,
        "created_at": user.created_at.isoformat() if user.created_at else "",
    }


@router.get("/users")
def list_users(db: Session = Depends(get_db), _admin: User = Depends(require_admin)) -> list[dict]:
    return [_user_out(u) for u in db.query(User).order_by(User.created_at.desc()).all()]


@router.patch("/users/{uid}")
def patch_user(
    uid: str, body: UserPatch, db: Session = Depends(get_db), admin: User = Depends(require_admin)
) -> dict:
    if uid == admin.id:
        raise HTTPException(status_code=422, detail="No puedes modificar tu propio admin")
    user = db.get(User, uid)
    if user is None:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    if body.is_active is not None:
        user.is_active = body.is_active
    if body.role is not None:
        if body.role not in ("user", "admin"):
            raise HTTPException(status_code=422, detail="Rol inválido")
        user.role = body.role
    db.commit()
    db.refresh(user)
    return _user_out(user)


@router.get("/projects")
def all_projects(
    db: Session = Depends(get_db), _admin: User = Depends(require_admin)
) -> list[dict]:
    rows = db.query(Project).order_by(Project.updated_at.desc()).limit(500).all()
    owners = {u.id: u.email for u in db.query(User).filter(User.id.in_([p.owner_id for p in rows])).all()}
    return [
        {
            "id": p.id,
            "owner_email": owners.get(p.owner_id, "?"),
            "name": p.name,
            "updated_at": p.updated_at.isoformat() if p.updated_at else "",
        }
        for p in rows
    ]


@router.delete("/projects/{pid}", status_code=204)
def delete_any_project(
    pid: str, db: Session = Depends(get_db), _admin: User = Depends(require_admin)
) -> None:
    project = db.get(Project, pid)
    if project is None:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")
    db.delete(project)
    db.commit()


@router.get("/events")
def list_events(
    tool: str = "",
    action: str = "",
    limit: int = 200,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> list[dict]:
    query = db.query(DesignEvent).order_by(DesignEvent.created_at.desc())
    if tool:
        query = query.filter_by(tool=tool[:64])
    if action:
        query = query.filter_by(action=action[:64])
    rows = query.limit(min(max(limit, 1), 1000)).all()
    owners = {u.id: u.email for u in db.query(User).filter(User.id.in_([e.user_id for e in rows])).all()}
    return [
        {
            "id": e.id,
            "user_email": owners.get(e.user_id, "?"),
            "project_id": e.project_id,
            "tool": e.tool,
            "action": e.action,
            "created_at": e.created_at.isoformat() if e.created_at else "",
        }
        for e in rows
    ]


@router.get("/stats")
def stats(db: Session = Depends(get_db), _admin: User = Depends(require_admin)) -> dict:
    by_tool = dict(db.query(DesignEvent.tool, func.count()).group_by(DesignEvent.tool).all())
    by_action = dict(db.query(DesignEvent.action, func.count()).group_by(DesignEvent.action).all())
    return {
        "users": db.query(func.count(User.id)).scalar(),
        "verified": db.query(func.count(User.id)).filter_by(is_verified=True).scalar(),
        "admins": db.query(func.count(User.id)).filter_by(role="admin").scalar(),
        "projects": db.query(func.count(Project.id)).scalar(),
        "events": db.query(func.count(DesignEvent.id)).scalar(),
        "by_tool": by_tool,
        "by_action": by_action,
    }


@router.get("/smtp")
def read_smtp(db: Session = Depends(get_db), _admin: User = Depends(require_admin)) -> dict:
    return smtp_public(get_settings(db))


@router.put("/smtp")
def update_smtp(
    body: SmtpSettingsIn,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    if body.encryption not in ("none", "starttls", "ssl"):
        raise HTTPException(status_code=422, detail="Cifrado SMTP invalido")
    if body.enabled and (not body.host.strip() or not body.from_email):
        raise HTTPException(status_code=422, detail="Servidor y remitente son obligatorios al activar SMTP")
    settings = get_settings(db)
    if settings is None:
        settings = SmtpSettings(key="default")
        db.add(settings)
    settings.enabled = body.enabled
    settings.host = body.host.strip()
    settings.port = body.port
    settings.encryption = body.encryption
    settings.username = body.username.strip()
    settings.from_email = str(body.from_email)
    settings.from_name = body.from_name.strip()
    settings.updated_by = admin.email
    if body.clear_password:
        settings.password_encrypted = ""
    elif body.password:
        settings.password_encrypted = encrypt_password(body.password)
    db.commit()
    db.refresh(settings)
    return smtp_public(settings)


@router.post("/smtp/test")
def test_smtp(
    body: SmtpTestIn,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    settings = get_settings(db)
    if settings is None:
        raise HTTPException(status_code=422, detail="Guarda primero la configuracion SMTP")
    recipient = str(body.recipient or admin.email)
    try:
        send_email(
            settings,
            recipient,
            "Prueba SMTP de OpenSemiLab",
            "La configuracion SMTP de OpenSemiLab funciona correctamente.\n",
        )
    except (OSError, RuntimeError, smtplib.SMTPException) as error:
        # Nunca retornar credenciales ni el contenido cifrado.
        raise HTTPException(
            status_code=502,
            detail=f"No se pudo enviar: {type(error).__name__}",
        ) from error
    return {"ok": True, "recipient": recipient}
