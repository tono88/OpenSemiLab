"""Gestion explicita del primer administrador desde el contenedor API."""

import argparse

from opensemilab_api.db import SessionLocal, init_db
from opensemilab_api.models_db import User


def main() -> None:
    parser = argparse.ArgumentParser(prog="opensemilab-admin")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("list", help="Listar usuarios y roles")
    promote = sub.add_parser("promote", help="Promover un usuario existente")
    promote.add_argument("email")
    demote = sub.add_parser("demote", help="Quitar rol administrador")
    demote.add_argument("email")
    args = parser.parse_args()

    init_db()
    db = SessionLocal()
    try:
        if args.command == "list":
            users = db.query(User).order_by(User.created_at).all()
            if not users:
                print("No hay usuarios registrados.")
            for user in users:
                print(f"{user.email}\t{user.role}\tverified={user.is_verified}\tactive={user.is_active}")
            return
        email = args.email.strip().lower()
        user = db.query(User).filter_by(email=email).first()
        if user is None:
            raise SystemExit(f"No existe el usuario {email}; registralo primero desde la web.")
        user.role = "admin" if args.command == "promote" else "user"
        if args.command == "promote":
            user.is_active = True
            user.is_verified = True
        db.commit()
        print(f"{email}: role={user.role}, verified={user.is_verified}, active={user.is_active}")
    finally:
        db.close()
