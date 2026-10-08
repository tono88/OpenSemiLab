"""SMTP administrable, cifrado en reposo y sin exponer secretos por API."""

import base64
import hashlib
import logging
import os
import smtplib
import ssl
from email.message import EmailMessage

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy.orm import Session

from opensemilab_api.models_db import SmtpSettings

log = logging.getLogger("opensemilab.smtp")


def _cipher() -> Fernet:
    source = os.getenv("OPENSEMILAB_SETTINGS_KEY") or os.getenv("JWT_SECRET", "dev-only-change-me")
    key = base64.urlsafe_b64encode(hashlib.sha256(source.encode()).digest())
    return Fernet(key)


def encrypt_password(value: str) -> str:
    return _cipher().encrypt(value.encode()).decode() if value else ""


def decrypt_password(value: str) -> str:
    if not value:
        return ""
    try:
        return _cipher().decrypt(value.encode()).decode()
    except InvalidToken as error:
        raise RuntimeError(
            "No se pudo descifrar la clave SMTP; revisa OPENSEMILAB_SETTINGS_KEY"
        ) from error


def get_settings(db: Session) -> SmtpSettings | None:
    return db.get(SmtpSettings, "default")


def smtp_public(settings: SmtpSettings | None) -> dict:
    if settings is None:
        return {
            "enabled": False,
            "host": "",
            "port": 587,
            "encryption": "starttls",
            "username": "",
            "from_email": "",
            "from_name": "OpenSemiLab",
            "has_password": False,
            "updated_by": "",
            "updated_at": "",
        }
    return {
        "enabled": settings.enabled,
        "host": settings.host,
        "port": settings.port,
        "encryption": settings.encryption,
        "username": settings.username,
        "from_email": settings.from_email,
        "from_name": settings.from_name,
        "has_password": bool(settings.password_encrypted),
        "updated_by": settings.updated_by,
        "updated_at": settings.updated_at.isoformat() if settings.updated_at else "",
    }


def send_email(settings: SmtpSettings, recipient: str, subject: str, text: str) -> None:
    if not settings.host or not settings.from_email:
        raise RuntimeError("Faltan el servidor SMTP o el remitente")
    password = decrypt_password(settings.password_encrypted)
    message = EmailMessage()
    message["From"] = f"{settings.from_name} <{settings.from_email}>" if settings.from_name else settings.from_email
    message["To"] = recipient
    message["Subject"] = subject
    message.set_content(text)

    context = ssl.create_default_context()
    connection: smtplib.SMTP
    if settings.encryption == "ssl":
        connection = smtplib.SMTP_SSL(settings.host, settings.port, timeout=20, context=context)
    else:
        connection = smtplib.SMTP(settings.host, settings.port, timeout=20)
    try:
        connection.ehlo()
        if settings.encryption == "starttls":
            connection.starttls(context=context)
            connection.ehlo()
        if settings.username:
            connection.login(settings.username, password)
        connection.send_message(message)
    finally:
        try:
            connection.quit()
        except (OSError, smtplib.SMTPException):
            connection.close()


def send_configured_email(
    db: Session, recipient: str, subject: str, text: str
) -> bool | None:
    """True=sent, False=configured but failed, None=SMTP disabled/unconfigured."""
    settings = get_settings(db)
    if settings is None or not settings.enabled:
        return None
    try:
        send_email(settings, recipient, subject, text)
        return True
    except (OSError, RuntimeError, smtplib.SMTPException) as error:
        log.error("SMTP delivery failed for %s: %s", recipient, type(error).__name__)
        return False
