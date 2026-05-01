# Sync vs Async en Python: Lambda vs ECS/Fargate

> **TL;DR** — En AWS Lambda, el código asíncrono (`async`/`await`) no aporta
> ningún beneficio de rendimiento. En ECS/Fargate (contenedores de larga
> duración), sí puede mejorar significativamente el throughput. Esta guía
> explica por qué.

---

## 1. ¿Qué problema resuelve `async`?

El modelo `async`/`await` de Python (basado en `asyncio`) permite que **un
único hilo** gestione múltiples operaciones de I/O concurrentes. Mientras una
corrutina espera una respuesta de red (p. ej., una query a la base de datos),
el event loop cede el control a otra corrutina, manteniendo la CPU ocupada.

```
Hilo único — event loop asyncio
│
├─▶ query A (espera BD) ──────────────────────────▶ resultado A
│            │ ← cede el control
└─────────── ├─▶ query B (espera BD) ────────────▶ resultado B
             │            │ ← cede el control
             └─────────── └─▶ query C (espera BD) ▶ resultado C
```

**La clave:** varias operaciones de I/O se solapan en el tiempo dentro del
mismo hilo. Esto es especialmente útil cuando tienes **muchas peticiones
entrantes simultáneas** gestionadas por el mismo proceso.

---

## 2. Cómo funciona Lambda

Lambda ejecuta **una única invocación por contenedor de ejecución**. Cuando
llega una segunda petición simultánea, AWS crea un **segundo contenedor**
independiente.

```
Petición 1 ──▶ [Contenedor Lambda A]  (1 hilo, 1 invocación)
Petición 2 ──▶ [Contenedor Lambda B]  (1 hilo, 1 invocación)
Petición 3 ──▶ [Contenedor Lambda C]  (1 hilo, 1 invocación)
```

Cada contenedor:
- Procesa **exactamente una petición** en cada momento
- No comparte estado ni recursos con otros contenedores
- Tiene su propio event loop (si usas `async`)

### ¿Por qué `async` no ayuda aquí?

Dentro de un contenedor Lambda con una sola invocación activa, no hay otras
corrutinas esperando que el event loop pueda ejecutar mientras tu query a
PostgreSQL termina. El event loop está vacío.

```
Lambda — una invocación
│
└─▶ await db.query(...)   ← el event loop espera... vacío.
                             No hay otras corrutinas que ejecutar.
```

El resultado es **idéntico** al código síncrono:

```
Lambda — una invocación (sync)
│
└─▶ db.query(...)   ← el hilo espera... el resultado es el mismo.
```

**Conclusión:** `async` en Lambda añade complejidad (event loop, librerías
asíncronas como `asyncpg`, `aiohttp`) sin ningún beneficio de rendimiento.

---

## 3. Cómo funciona ECS/Fargate (contenedores de larga duración)

Un servicio ECS tiene **un número fijo de tareas** (contenedores) que atienden
todas las peticiones entrantes. Si tienes 2 tareas y llegan 100 peticiones
simultáneas, cada tarea debe gestionar ~50 peticiones concurrentes.

```
                    ┌─────────────────────────────────────┐
Petición 1  ──▶     │  Tarea ECS A  (1 proceso Python)    │
Petición 2  ──▶     │                                     │
Petición 3  ──▶     │  event loop asyncio                 │
...         ──▶     │  gestiona N corrutinas en paralelo  │
Petición 50 ──▶     └─────────────────────────────────────┘

                    ┌─────────────────────────────────────┐
Petición 51 ──▶     │  Tarea ECS B  (1 proceso Python)    │
...         ──▶     │  gestiona otras N corrutinas        │
Petición 100──▶     └─────────────────────────────────────┘
```

Aquí el event loop **sí tiene trabajo que hacer** mientras espera I/O:

```
Tarea ECS — muchas peticiones simultáneas
│
├─▶ await query petición 1 ────────────────────────▶ resultado
│            │ ← el event loop ejecuta otras corrutinas
├─────────── ├─▶ await query petición 2 ────────────▶ resultado
│            │
├─────────── └─▶ await query petición 3 ────────────▶ resultado
│            ...
└─ (miles de corrutinas solapadas en el tiempo)
```

Con código **síncrono** en ECS, cada petición bloquea el hilo:

```
Tarea ECS — síncrono (un hilo)
│
├─▶ query petición 1 [espera 20ms] ─▶ resultado
└─ (petición 2 espera en cola hasta que termine la 1)
```

Para atender varias peticiones en paralelo con código síncrono necesitarías
múltiples **workers** (procesos o hilos). Uvicorn + Gunicorn hace esto, pero
`async` con un solo worker puede ser más eficiente en memoria.

---

## 4. Tabla comparativa

| Característica | Lambda | ECS/Fargate |
|---|---|---|
| Concurrencia por instancia | 1 invocación | N peticiones simultáneas |
| Escala horizontal | Automática (AWS) | Manual/Auto Scaling |
| Event loop útil | ❌ No | ✅ Sí |
| `async` aporta beneficio | ❌ No | ✅ Sí |
| Pool de conexiones BD | ❌ NullPool | ✅ Pool recomendado |
| Librería BD recomendada | `psycopg2` (sync) | `asyncpg` o `psycopg3` |

---

## 5. Decisión de diseño en este proyecto

Este proyecto usa **Lambda + FastAPI (Mangum)**. Por eso:

- ✅ `psycopg2` síncrono con `NullPool`
- ✅ `SQLAlchemy` síncrono (`create_engine` con `poolclass=NullPool`)
- ❌ ~~`asyncpg`~~ — eliminado
- ❌ ~~`async_sessionmaker`~~ — eliminado
- ❌ ~~`AsyncSession`~~ — eliminado

### ¿Por qué `NullPool` en Lambda?

Los contenedores Lambda son efímeros. Si usáramos un pool de conexiones
estándar, cada invocación abriría conexiones que quedarían abiertas en el pool
hasta que el contenedor se destruya. Con muchas invocaciones paralelas, Aurora
agotaría rápidamente sus conexiones máximas.

`NullPool` **no mantiene conexiones abiertas** entre invocaciones. Cada
request abre una conexión, la usa, y la cierra. Esto es correcto para Lambda.

```python
# engine.py — NullPool para Lambda
engine = create_engine(dsn, poolclass=NullPool)
```

### Diagrama de ciclo de vida de conexión

```
Lambda (NullPool)                Aurora Serverless v2
│                                │
├─ invocación 1                  │
│   ├─▶ connect() ───────────────▶ conexión abierta
│   ├─▶ query(...)               │
│   └─▶ close() ─────────────────▶ conexión cerrada
│                                │
├─ (contenedor hibernado)        │
│                                │
└─ invocación 2                  │
    ├─▶ connect() ───────────────▶ nueva conexión
    ├─▶ query(...)               │
    └─▶ close() ─────────────────▶ conexión cerrada
```

---

## 6. ¿Y si migramos a ECS en el futuro?

Si en algún momento el proyecto migra a ECS/Fargate, los cambios serían:

1. Reemplazar `psycopg2-binary` por `asyncpg` o `psycopg[async]`
2. Reemplazar `NullPool` por `AsyncAdaptedQueuePool` (o `QueuePool` síncrono)
3. Reemplazar `Session` por `AsyncSession`
4. Añadir `async`/`await` en repositorios y use cases
5. Cambiar `uvicorn` a modo multi-worker con `--workers N`

La arquitectura limpia (puertos & adaptadores) de este proyecto facilita este
cambio: sólo hay que reescribir el adaptador `PostgresRecipeRepository` y el
`DatabaseConnectionPool` en `engine.py`.

---

## Referencias

- [AWS Lambda — Execution Environment](https://docs.aws.amazon.com/lambda/latest/dg/runtimes-context.html)
- [SQLAlchemy — NullPool](https://docs.sqlalchemy.org/en/20/core/pooling.html#sqlalchemy.pool.NullPool)
- [asyncio — When to use async](https://docs.python.org/3/library/asyncio.html)
- [Aurora Serverless v2 — Connection limits](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2.html)
