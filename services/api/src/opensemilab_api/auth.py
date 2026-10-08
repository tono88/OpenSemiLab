"""Auth email+password solo dominio institucional.

Regla activa: cualquier `.edu` / `.edu.<ccTLD>` (ej: .edu, .edu.gt, .edu.mx, .edu.sv).
Cobertura: dominio .edu (EE. UU.) + aproximadamente 60 países con edu como dominio de segundo nivel.

Sin OAuth de Google por decisión explícita.
Recuperación: token de un solo uso; en dev se devuelve/loguea,
en LAB se manda por SMTP (pendiente Fase C).
"""

import hashlib
import logging
import os
import re
import secrets
from datetime import datetime, timedelta

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from opensemilab_api.db import get_db, init_db
from opensemilab_api.models_db import EmailVerification, PasswordReset, User
from opensemilab_api.smtp_service import send_configured_email

log = logging.getLogger("opensemilab.auth")
router = APIRouter(prefix="/api/v1/auth", tags=["auth"])
_bearer = HTTPBearer(auto_error=False)

# Freno anti fuerza-bruta con escalado: 5 fallos → 10 min, 8 → 30 min,
# 12 → 1 h, 16+ → 12 h. Clave por IP+correo (una IP de la U no bloquea a otros).
# En memoria (piloto, una instancia): al reiniciar se limpia.
_LOCK: dict[str, dict] = {}
_LEVELS = [(5, 10), (8, 30), (12, 60), (16, 720)]  # (fallos acumulados, minutos)


def _lock_check(key: str) -> None:
    rec = _LOCK.get(key)
    if rec and datetime.utcnow() < rec["until"]:
        left = int((rec["until"] - datetime.utcnow()).total_seconds() // 60) + 1
        raise HTTPException(
            status_code=429,
            detail=f"Demasiados intentos. Bloqueado ~{left} min por seguridad",
        )


def _lock_fail(key: str) -> None:
    rec = _LOCK.get(key, {"fails": 0, "until": datetime.min})
    rec["fails"] += 1
    minutes = 0
    for threshold, mins in _LEVELS:
        if rec["fails"] >= threshold:
            minutes = mins
    if minutes:
        rec["until"] = datetime.utcnow() + timedelta(minutes=minutes)
    _LOCK[key] = rec


def _lock_ok(key: str) -> None:
    _LOCK.pop(key, None)


# Ventana simple para endpoints que no son login (registro, reenvío).
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

SESSION_COOKIE = "opensemilab_session"
_COOKIE_SECURE = os.getenv("OPENSEMILAB_COOKIE_SECURE", "0") == "1"


def _cookie_kwargs() -> dict:
    kw: dict = {
        "httponly": True,
        "samesite": "lax",
        "path": "/",
        "max_age": JWT_EXPIRE_MIN * 60,
    }
    if _COOKIE_SECURE:
        kw["secure"] = True
    return kw

if JWT_SECRET == "dev-only-change-me":
    log.warning("JWT_SECRET es el valor de dev — define uno real en el LAB")


# --- dominio permitido -------------------------------------------------------
# Acepta .edu y .edu.<ccTLD> (ej: universidad.edu, unis.edu.gt, itesm.edu.mx).
_EDU_RE = re.compile(r"\.edu(\.[a-z]{2,})?$")


def is_allowed_email(email: str) -> bool:
    domain = email.strip().lower().rsplit("@", 1)[-1]
    return bool(_EDU_RE.search(domain))


def _public_url() -> str:
    return os.getenv("OPENSEMILAB_PUBLIC_URL", "http://localhost:5173").rstrip("/")


def _new_verify_token(db: Session, user: User) -> tuple[str, bool | None]:
    raw = secrets.token_urlsafe(32)
    db.add(
        EmailVerification(
            user_id=user.id,
            token_sha=hashlib.sha256(raw.encode()).hexdigest(),
            expires_at=datetime.utcnow() + timedelta(hours=48),
        )
    )
    db.commit()
    link = f"{_public_url()}/#/verificar?token={raw}"
    sent = send_configured_email(
        db,
        user.email,
        "Verifica tu cuenta de OpenSemiLab",
        f"Hola {user.name or user.email},\n\nActiva tu cuenta con este enlace (valido 48 horas):\n{link}\n",
    )
    if sent is None:
        log.warning("Verify %s -> %s (SMTP desactivado)", user.email, link)
    return raw, sent


def _issue_token(user: User) -> str:
    payload = {
        "sub": user.id,
        "email": user.email,
        "role": user.role,
        "exp": datetime.utcnow() + timedelta(minutes=JWT_EXPIRE_MIN),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def get_current_user(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    # Sesión por cookie httpOnly (front) o Bearer (tests/Swagger/API directa).
    token = creds.credentials if creds is not None else request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(status_code=401, detail="Falta sesión (login requerido)")
    try:
        data = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
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


class ResendIn(BaseModel):
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
            detail="Solo correos institucionales .edu (ej: tu@universidad.edu, tu@unis.edu.gt, tu@uni.edu.mx)",
        )
    if db.query(User).filter_by(email=email).first():
        raise HTTPException(status_code=409, detail="Ese correo ya está registrado")
    user = User(email=email, name=body.name.strip(), password_hash=_hash_pw(body.password))
    # Primeros admins: correos conocidos del equipo (Estuardo/André se marcan manual o aquí).
    db.add(user)
    db.commit()
    db.refresh(user)
    raw, sent = _new_verify_token(db, user)
    out: dict = {"ok": True, "email": user.email, "verify_required": True, "email_sent": sent}
    if os.getenv("OPENSEMILAB_EXPOSE_RESET_TOKEN") == "1":
        out["dev_token"] = raw
    return out


@router.post("/login")
def login(
    body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)
) -> dict:
    init_db()
    email = body.email.strip().lower()
    key = f"login:{request.client.host if request.client else '?'}:{email}"
    _lock_check(key)
    user = db.query(User).filter_by(email=email).first()
    if user is None or not _verify_pw(body.password, user.password_hash):
        _lock_fail(key)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Correo o contraseña inválidos"
        )
    _lock_ok(key)
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Usuario desactivado")
    if not user.is_verified:
        raise HTTPException(
            status_code=403,
            detail="Verifica tu correo institucional antes de entrar (revisa tu inbox)",
        )
    token = _issue_token(user)
    response.set_cookie(SESSION_COOKIE, token, **_cookie_kwargs())
    return {"token": token, "email": user.email, "role": user.role}


@router.post("/logout")
def logout(response: Response) -> dict:
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


@router.get("/verify")
def verify(token: str, response: Response, db: Session = Depends(get_db)) -> dict:
    init_db()
    digest = hashlib.sha256(token.encode()).hexdigest()
    rec = db.query(EmailVerification).filter_by(token_sha=digest, used=False).first()
    if rec is None or rec.expires_at < datetime.utcnow():
        raise HTTPException(status_code=422, detail="Link inválido o vencido, pide uno nuevo")
    user = db.get(User, rec.user_id)
    if user is None:
        raise HTTPException(status_code=422, detail="Link inválido")
    user.is_verified = True
    rec.used = True
    db.commit()
    fresh = _issue_token(user)
    response.set_cookie(SESSION_COOKIE, fresh, **_cookie_kwargs())
    return {"token": fresh, "email": user.email, "role": user.role}


@router.post("/resend")
def resend(body: ResendIn, request: Request, db: Session = Depends(get_db)) -> dict:
    _throttle(f"resend:{request.client.host if request.client else '?'}")
    init_db()
    email = body.email.strip().lower()
    user = db.query(User).filter_by(email=email).first()
    if user is None or user.is_verified:
        return {"ok": True}
    raw, _sent = _new_verify_token(db, user)
    out: dict = {"ok": True}
    if os.getenv("OPENSEMILAB_EXPOSE_RESET_TOKEN") == "1":
        out["dev_token"] = raw
    return out


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
    link = f"{_public_url()}/#/restablecer?token={raw}"
    _sent = send_configured_email(
        db,
        email,
        "Restablece tu contrasena de OpenSemiLab",
        f"Solicitaste restablecer tu contrasena. Usa este enlace (valido 2 horas):\n{link}\n",
    )
    if _sent is None:
        log.warning("Password reset para %s -> %s (SMTP desactivado)", email, link)
    # Mantener respuesta indistinguible para no revelar si el correo existe.
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
