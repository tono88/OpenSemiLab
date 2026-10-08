# Decisiones — OpenSemiLab UNIS (rama `andregl`)

> Bitácora viva de decisiones André + Estuardo. Última actualización: 2026-09-30.

## Auth
1. **Acceso con correo institucional `.edu`** (`auth.py:is_allowed_email`, regex `\.edu(\.[a-z]{2,})?$` sobre el dominio en minúsculas). Acepta `.edu` y `.edu.<ccTLD>` (ej: `.edu`, `.edu.gt`, `.edu.mx`, `.edu.sv`). Cobertura: dominio `.edu` (EE. UU.) + aproximadamente 60 países con `edu` como dominio de segundo nivel. Cambio aprobado por Estuardo el 2026-09-30; las cuentas `@unis.edu.gt` existentes conservan acceso sin migración.
2. **Sin OAuth de Google** (decisión explícita 2026-09-26). Email + password con hash PBKDF2 stdlib (se evitó bcrypt por líos nativos en Windows/Docker).
3. **Loop de verificación por inbox**: registro → link `#/verificar?token=` (48 h) → login. Sin click no hay entrada. Así se verifica que el correo institucional `.edu` pertenece a quien se registra.
4. **Sesión en cookie httpOnly** (`opensemilab_session`, SameSite=Lax, 12 h). Bearer se conserva para tests/Swagger/API directa. En prod HTTPS: `OPENSEMILAB_COOKIE_SECURE=1`.
5. **Bloqueo escalado en login** (por IP+correo, en memoria): 5 fallos→10 min, 8→30 min, 12→1 h, 16+→12 h. Login bueno resetea. Registro/reenvío: ventana simple 8/5 min.
6. **SMTP real**: `info@tecnodyne.com` (Gmail + contraseña de aplicación del profe), configurable solo por portal `#/admin` (guardada cifrada, jamás se expone por API). Verificado envío real el 2026-10-08.
14. **Links jamás se pierden**: si el SMTP está desactivado o el envío falla, el link de verificación/recuperación queda en el log del servidor (`auth.py`, respuesta `email_sent`: True=enviado, False=falló, None=apagado). El mensaje de "Recuperar contraseña" es neutro (sin mencionar logs) y la respuesta es indistinguible exista o no el correo.

## Datos
7. **Postgres oficial** (PG18 local de André; LAB después). SQLite solo fallback dev/test. Volumen `pgdata` en compose. Tablas: `users`, `projects`, `design_events`, `password_resets`, `email_verifications`, `access_requests`.
8. **Proyectos por usuario + galería abierta estilo Tinkercad**: cualquier cuenta `.edu` ve/clona todo; sync servidor↔navegador (gana el más reciente, localStorage = caché offline).
9. **Admin total** (solo Estuardo + André, `role=admin` por SQL): ver/desactivar/borrar usuarios y proyectos, stats, eventos con CSV. Nadie se modifica a sí mismo.
10. **Telemetría mínima**: `{project_id, tool, action}` en plan creado, import GitHub, corridas EDA/adapters y físicos. Aviso en Términos + Privacidad.
11. **OneDrive descartado**: con servidor LAB + PG no aporta; export manual `.opensemilab.json` sigue disponible.

## Front
12. Reusar tipografía/diseño existente (Manrope + DM Mono, paleta `#07120f/#45e6a6`, ES/EN). **Sin flechas `→/↗`** en páginas nuevas. Código de Estuardo solo se toca para cableado (token), nunca diseño.
13. Rutas hash (sin deps): `#/` landing, `#/equipo`, `#/terminos`, `#/privacidad`, `#/login`, `#/registro`, `#/recuperar`, `#/verificar`, `#/galeria`, `#/admin`, `#/lab`.

## Pendientes
- Secrets prod (`JWT_SECRET`, `POSTGRES_PASSWORD`, `OPENSEMILAB_COOKIE_SECURE=1`), PG del LAB, SMTP.
- Lockout a DB si hay multi-worker. `DECISIONES.md` al día por fase.
