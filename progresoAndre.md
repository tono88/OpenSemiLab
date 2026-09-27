# progresoAndre — réplica y estado (rama `andregl`)

> Para Estuardo: cómo levantar lo de André y qué se hizo. Actualizado: 2026-09-27.

## 1. Requisitos
- Node.js 20+, Python 3.11+, PostgreSQL 14+ (o el servicio `db` del compose), pgAdmin (opcional), Git.

## 2. Levantar en local (5 min)
```powershell
git clone https://github.com/tono88/OpenSemiLab.git
cd OpenSemiLab
git checkout andregl
```

**DB** (pgAdmin o psql, una vez):
```sql
CREATE DATABASE opensemilab;
CREATE USER opensemilab WITH PASSWORD '<APP_PASSWORD>';
GRANT ALL PRIVILEGES ON DATABASE opensemilab TO opensemilab;
-- conectado a opensemilab:
ALTER SCHEMA public OWNER TO opensemilab;
```

**API** (terminal 1):
```powershell
cd services/api
pip install -e ".[dev]"
$env:DATABASE_URL='postgresql+psycopg://opensemilab:<APP_PASSWORD>@localhost:5432/opensemilab'
$env:OPENSEMILAB_EXPOSE_RESET_TOKEN='1'   # solo dev: expone dev_token en registro
uvicorn opensemilab_api.main:app --port 8000
```
Sin `DATABASE_URL` cae a SQLite local (solo dev). Tablas se crean solas al arrancar.

**Web** (terminal 2):
```powershell
cd apps/web
npm install
npm run dev     # http://localhost:5173  (proxea /api → :8000)
```

**Usuario de prueba**:
```powershell
cd services/api
python seed_dev.py   # crea prueba@unis.edu.gt / Unis1234 (verificado)
```

## 3. Flujo de verificación (dev, sin SMTP)
1. `#/registro` con tu `@unis.edu.gt` → pantalla "Revisa tu correo".
2. El link sale en la **terminal del API**: `Verify tu@unis.edu.gt -> #/verificar?token=...`
3. Ábrelo → entras al Lab. (Con `OPENSEMILAB_EXPOSE_RESET_TOKEN=1` el `dev_token` también viene en la respuesta.)

## 4. Hacerte admin
Regístrate + verifícate, luego en pgAdmin (Query Tool sobre `opensemilab`, F5):
```sql
UPDATE users SET role='admin', is_verified=TRUE WHERE email='tu@unis.edu.gt';
```
Sal/entran → aparece **Admin** en el header (`#/admin`: usuarios, proyectos, eventos, CSV).

## 5. Qué se hizo (por commit, todo en `andregl`)
| Commit | Qué |
|---|---|
| Fase A: Postgres + auth | `db`, PG en compose, registro/login `/me`/forgot/reset solo `@unis.edu.gt`, hash PBKDF2 |
| Fase B: front público | landing, equipo (fotos+QR LinkedIn), términos, privacidad, login/registro/recuperar, gate visual |
| Fixes landing | botones, ES/EN, responsive, seed `prueba@`, sin flechas en páginas nuevas |
| Seguridad | auth obligatoria en API (401 anónimo), token en los 18 fetches, throttle, anti-doble-submit |
| Verificación inbox | loop `#/verificar`, login bloqueado sin verificar, reenvío |
| Lockout | 5→10 min, 8→30 min, 12→1 h, 16+→12 h (por IP+correo) |
| Fase C | proyectos por usuario + sync + galería clonable, eventos, panel admin full |
| Cookies | sesión httpOnly (`opensemilab_session`), Bearer solo tests/Swagger |

## 6. Verificar que todo jala
```powershell
cd services/api
python -m pytest tests/test_api.py -q   # 26 passed
cd ../../apps/web
npm run build                            # build ok
```
Manual: anónimo a `/api/v1/pdks` → 401; `#/lab` sin login → redirige; `#/admin` como user → login.

## 7. Env vars del API
| Var | Dev | Prod LAB |
|---|---|---|
| `DATABASE_URL` | `postgresql+psycopg://opensemilab:<pass>@localhost:5432/opensemilab` | igual, host del LAB |
| `JWT_SECRET` | default (avisa en log) | **secreto largo obligatorio** |
| `JWT_EXPIRE_MIN` | 720 | 720 (o menos) |
| `OPENSEMILAB_COOKIE_SECURE` | 0 | **1** (HTTPS) |
| `OPENSEMILAB_EXPOSE_RESET_TOKEN` | 1 (dev) | **no definir** |
| `POSTGRES_PASSWORD` | compose local | **secreto real** |
| SMTP (`SMTP_*`) | — (log) | pendiente buzón `noreply@unis.edu.gt` + App Password |

Nada de lo anterior va commiteado: solo env locales. Dudas → André.
