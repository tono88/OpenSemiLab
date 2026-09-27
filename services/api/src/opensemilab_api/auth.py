"""Auth email+password solo dominio institucional.

Regla activa: solo `@unis.edu.gt` (pedido de André/Estuardo por mientras).
Regla futura (comentada abajo): cualquier `.edu` / `.edu.gt`.

Sin OAuth de Google por decisión explícita.
Recuperación: token de un solo uso; en dev se devuelve/loguea,
en LAB se manda por SMTP (pendiente Fase C).
"""

import hashlib
import logging
import os
import secrets
from datetime import datetime, timedelta

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from opensemilab_api.db import get_db, init_db
from opensemilab_api.models_db import PasswordReset, User

log = logging.getLogger("opensemilab.auth")
router = APIRouter(prefix="/api/v1/auth", tags=["auth"])
_bearer = HTTPBearer(auto_error=False)

# Freno simple anti fuerza-bruta: 8 intentos / 5 min por IP.
_ATTEMPTS: dict[str, list[datetime]] = {}
_ATTEMPT_LIMIT = 8
_ATTEMPT_WINDOW = timedelta(minutes=5)


def _throttle(key: str) -> None:
    now = datetime.utcnow()
    hits = [t for t in _ATTEMPTS.get(key, []) if now - t < _ATTEMPT_WINDOW]
    if len(hits) >= _ATTEMPT_LIMIT:
        raise HTTPException(status_code=429, detail="Demasiados intentos, espera unos minutos")
    hits.append(now)
    _ATTEMPTS[key] = hits


def _hash_pw(password: str) -> str:
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 210_000)
    return f"pbkdf2$210000${salt}${dk.hex()}"


def _verify_pw(password: str, stored: str) -> bool:
    try:
        _, iters, salt, hexdk = stored.split("$")
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), int(iters))
        return secrets.compare_digest(dk.hex(), hexdk)
    except Exception:
        return False

JWT_SECRET = os.getenv("JWT_SECRET", "dev-only-change-me")
JWT_EXPIRE_MIN = int(os.getenv("JWT_EXPIRE_MIN", "720"))

if JWT_SECRET == "dev-only-change-me":
    log.warning("JWT_SECRET es el valor de dev — define uno real en el LAB")


# --- dominio permitido -------------------------------------------------------
def is_allowed_email(email: str) -> bool:
    domain = email.strip().lower().rsplit("@", 1)[-1]
    # ACTIVO: solo UNIS por mientras.
    if domain == "unis.edu.gt":
        return True
    # FUTURO (.edu general, dejar comentado según lo pedido):
    # if domain == "unis.edu.gt" or domain.endswith(".edu") or domain.endswith(".edu.gt"):
    #     return True
    return False


def _issue_token(user: User) -> str:
    payload = {
        "sub": user.id,
        "email": user.email,
        "role": user.role,
        "exp": datetime.utcnow() + timedelta(minutes=JWT_EXPIRE_MIN),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    if creds is None:
        raise HTTPException(status_code=401, detail="Falta sesión (login requerido)")
    try:
        data = jwt.decode(creds.credentials, JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Sesión inválida o vencida") from None
    user = db.get(User, data.get("sub", ""))
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="Usuario inactivo")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Solo admins (Estuardo / André)")
    return user


# --- schemas -----------------------------------------------------------------
class RegisterIn(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=8, max_length=128)


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class ForgotIn(BaseModel):
    email: EmailStr


class ResetIn(BaseModel):
    token: str = Field(min_length=16, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


# --- endpoints ---------------------------------------------------------------
@router.post("/register", status_code=201)
def register(body: RegisterIn, request: Request, db: Session = Depends(get_db)) -> dict:
    _throttle(f"reg:{request.client.host if request.client else '?'}")
    init_db()
    email = body.email.strip().lower()
    if not is_allowed_email(email):
        raise HTTPException(
            status_code=403,
            detail="Por ahora solo correos @unis.edu.gt (soporte .edu general viene después)",
        )
    if db.query(User).filter_by(email=email).first():
        raise HTTPException(status_code=409, detail="Ese correo ya está registrado")
    user = User(email=email, name=body.name.strip(), password_hash=_hash_pw(body.password))
    # Primeros admins: correos conocidos del equipo (Estuardo/André se marcan manual o aquí).
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"token": _issue_token(user), "email": user.email, "role": user.role}


@router.post("/login")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)) -> dict:
    _throttle(f"login:{request.client.host if request.client else '?'}")
    init_db()
    email = body.email.strip().lower()
    user = db.query(User).filter_by(email=email).first()
    if user is None or not _verify_pw(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Correo o contraseña inválidos"
        )
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Usuario desactivado")
    return {"token": _issue_token(user), "email": user.email, "role": user.role}


@router.get("/me")
def me(user: User = Depends(get_current_user)) -> dict:
    return {"id": user.id, "email": user.email, "name": user.name, "role": user.role}


@router.post("/forgot")
def forgot(body: ForgotIn, db: Session = Depends(get_db)) -> dict:
    init_db()
    email = body.email.strip().lower()
    user = db.query(User).filter_by(email=email).first()
    # Respuesta genérica para no filtrar qué correos existen.
    if user is None:
        return {"ok": True}
    raw = secrets.token_urlsafe(32)
    digest = hashlib.sha256(raw.encode()).hexdigest()
    db.add(
        PasswordReset(
            user_id=user.id,
            token_sha=digest,
            expires_at=datetime.utcnow() + timedelta(hours=2),
        )
    )
    db.commit()
    # TODO Fase C: enviar por SMTP del LAB. En dev se loguea.
    log.warning("Password reset para %s token=%s (solo dev, mandar por SMTP en LAB)", email, raw)
    out: dict = {"ok": True}
    if os.getenv("OPENSEMILAB_EXPOSE_RESET_TOKEN") == "1":
        out["dev_token"] = raw
    return out


@router.post("/reset")
def reset(body: ResetIn, db: Session = Depends(get_db)) -> dict:
    init_db()
    digest = hashlib.sha256(body.token.encode()).hexdigest()
    rec = db.query(PasswordReset).filter_by(token_sha=digest, used=False).first()
    if rec is None or rec.expires_at < datetime.utcnow():
        raise HTTPException(status_code=422, detail="Token inválido o vencido")
    user = db.get(User, rec.user_id)
    if user is None:
        raise HTTPException(status_code=422, detail="Token inválido")
    user.password_hash = _hash_pw(body.new_password)
    rec.used = True
    db.commit()
    return {"ok": True}
