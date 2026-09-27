"""Crea el usuario de prueba local: prueba@unis.edu.gt / Unis1234.

Uso (una vez):
    cd services/api
    pip install -e .
    python seed_dev.py

Sbootstrap. No se corre en producción.
"""

import sys

sys.path.insert(0, "src")

from opensemilab_api.auth import _hash_pw  # noqa: E402
from opensemilab_api.db import SessionLocal, init_db  # noqa: E402
from opensemilab_api.models_db import User  # noqa: E402

EMAIL = "prueba@unis.edu.gt"
PASSWORD = "Unis1234"

init_db()
db = SessionLocal()
user = db.query(User).filter_by(email=EMAIL).first()
if user:
    user.password_hash = _hash_pw(PASSWORD)
    user.is_active = True
    print(f"actualizado: {EMAIL}")
else:
    db.add(User(email=EMAIL, name="Prueba", password_hash=_hash_pw(PASSWORD)))
    print(f"creado: {EMAIL}")
db.commit()
print(f"listo — entra con {EMAIL} / {PASSWORD}")
