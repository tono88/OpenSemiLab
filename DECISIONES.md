# Decisiones — OpenSemiLab UNIS (rama `andregl`)

> Bitácora viva de decisiones André + Estuardo. Última actualización: 2026-09-27.

## Auth
1. **Solo `@unis.edu.gt` por mientras** (`auth.py:is_allowed_email`). Regla `.edu` general comentada, se abre con 2 líneas.
2. **Sin OAuth de Google** (decisión explícita 2026-09-26). Email + password con hash PBKDF2 stdlib (se evitó bcrypt por líos nativos en Windows/Docker).
3. **Loop de verificación por inbox**: registro → link `#/verificar?token=` (48 h) → login. Sin click no hay entrada. Así se prueba que el correo es de verdad de la UNIS (solo TI emite `@unis.edu.gt`).
4. **Sesión en cookie httpOnly** (`opensemilab_session`, SameSite=Lax, 12 h). Bearer se conserva para tests/Swagger/API directa. En prod HTTPS: `OPENSEMILAB_COOKIE_SECURE=1`.
5. **Bloqueo escalado en login** (por IP+correo, en memoria): 5 fallos→10 min, 8→30 min, 12→1 h, 16+→12 h. Login bueno resetea. Registro/reenvío: ventana simple 8/5 min.
6. **SMTP pendiente**: buzón propuesto `noreply@unis.edu.gt` (UNIS usa Google Workspace). Dev loguea links; falta App Password.

## Datos
7. **Postgres oficial** (PG18 local de André; LAB después). SQLite solo fallback dev/test. Volumen `pgdata` en compose. Tablas: `users`, `projects`, `design_events`, `password_resets`, `email_verifications`, `access_requests`.
8. **Proyectos por usuario + galería abierta estilo Tinkercad**: cualquiera `@unis.edu.gt` ve/clona todo; sync servidor↔navegador (gana el más reciente, localStorage = caché offline).
9. **Admin total** (solo Estuardo + André, `role=admin` por SQL): ver/desactivar/borrar usuarios y proyectos, stats, eventos con CSV. Nadie se modifica a sí mismo.
10. **Telemetría mínima**: `{project_id, tool, action}` en plan creado, import GitHub, corridas EDA/adapters y físicos. Aviso en Términos + Privacidad.
11. **OneDrive descartado**: con servidor LAB + PG no aporta; export manual `.opensemilab.json` sigue disponible.

## Front
12. Reusar tipografía/diseño existente (Manrope + DM Mono, paleta `#07120f/#45e6a6`, ES/EN). **Sin flechas `→/↗`** en páginas nuevas. Código de Estuardo solo se toca para cableado (token), nunca diseño.
13. Rutas hash (sin deps): `#/` landing, `#/equipo`, `#/terminos`, `#/privacidad`, `#/login`, `#/registro`, `#/recuperar`, `#/verificar`, `#/galeria`, `#/admin`, `#/lab`.

## Pendientes
- Secrets prod (`JWT_SECRET`, `POSTGRES_PASSWORD`, `OPENSEMILAB_COOKIE_SECURE=1`), PG del LAB, SMTP.
- Lockout a DB si hay multi-worker. `DECISIONES.md` al día por fase.
