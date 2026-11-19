# Continuar aquí — rediseño del plan semanal, fase 1

> Escrito el 2026-11-19, al dejar el PC antiguo. Este archivo dice **en qué punto exacto está el
> trabajo** y **cómo seguir**. Cuando todo esté hecho y mergeado, bórralo.
>
> Para retomarlo con Claude Code: abre el repo en la rama `feat-recipes-block-1` y escribe
> *"lee CONTINUAR-AQUI.md y seguimos"*.

## 1. Dónde estamos

| | Estado |
|---|---|
| Decisiones (por qué) | [ADR-0009](docs/adr/0009-a-meal-is-recipes-products-and-notes.md): mergeado en `main` (PR #140) |
| Qué se construye (spec) | [docs/plans/meal-plan-phase-1.md](docs/plans/meal-plan-phase-1.md): bloque 1 (recetas) y bloque 2 (plan) |
| Fases 2 y 3 (Expo, IA que llena la semana) | [docs/todo/TODO_weekly-plan-redesign.md](docs/todo/TODO_weekly-plan-redesign.md) |
| **Bloque 1 — Recetas** | **Construido** en la rama `feat-recipes-block-1`. **Sin mergear.** La prueba a mano quedó **a medias** |
| Bloque 2 — El plan | Sin diseñar en detalle; se diseña después de probar el bloque 1 |

### Commits de la rama `feat-recipes-block-1` (encima de `main`)

| Commit | Qué |
|---|---|
| `643e0ed` | docs: fase 1 reorganizada (recetas primero, plan después) |
| `496bbc9` | backend: etiquetas, recetas solo de tu cocina, ingredientes opcionales |
| `ffb45c2` | backend: importar receta desde texto, enlace o foto (`POST /recipes/import`) |
| `42eac91` | backend: pesos en g y volúmenes en ml (500 g + 1 kg = una línea) |
| `b3631f0` | web: el flujo nuevo de añadir receta |
| `883b811` | web: la lista muestra kg y l; los opcionales salen desmarcados |
| `6afb24d` | docs: bloque 1 marcado como construido |
| (este archivo) | docs: traspaso |

Comprobado antes de irme: 592 tests de backend (con Postgres), 581 de frontend, lint y tipos en
verde; ninguna etiqueta se corta a 360 px en catalán ni castellano.

### Lo que falta del bloque 1 (casillas sin marcar en la spec)

- [ ] **La prueba a mano** (sección 3 de este archivo) y los ajustes que salgan de ella
- [ ] **Firewall:** añadir `/recipes/import` a la regla de rate limit (sección 4, paso 3)
- [ ] **`/ingredients/parse` a `deepseek-flash`:** la creación rápida desde el plan sigue en
      `deepseek-chat`. Se cambia con `LLM_PRIMARY_MODEL` cuando la prueba confirme que flash va bien
- [ ] Más tarde: etiquetar las recetas que ya existen, y reimportar las recetas reales para comparar

## 2. Montar el entorno en el PC nuevo

```bash
# Instalar: git, Node 24 (nvm), uv (Python), Docker Desktop
git clone <url-del-repo> sam && cd sam
git checkout feat-recipes-block-1
nvm use                                   # Node de .nvmrc (24)
npm install                               # frontend + infra (workspace npm)

cp .env.example .env                      # backend
cp frontend/.env.example frontend/.env.local
```

**Rellenar los secretos** (no están en GitHub, a propósito):

| Variable | Archivo | De dónde sacarla |
|---|---|---|
| `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID` | `.env` | AWS Console → Cognito (eu-west-3), o Vercel → `sam-api` → Settings → Environment Variables |
| `NEXT_PUBLIC_USER_POOL_ID`, `NEXT_PUBLIC_USER_POOL_CLIENT_ID` | `frontend/.env.local` | Los mismos dos valores |
| `DEEPSEEK_API_KEY` | `.env` | platform.deepseek.com → API keys, o Vercel → `sam-api` → env vars |
| `GEOAPIFY_API_KEY` | `.env` | Solo para restaurantes; no hace falta para probar recetas |
| `NEXT_PUBLIC_API_URL` | `frontend/.env.local` | **Debe ser `http://localhost:9000`**; si apunta a producción, escribes en datos reales |

No hace falta tocar `LLM_RECIPE_MODEL` ni `LLM_RECIPE_BASE_URL`: por defecto son `deepseek-flash`
en `https://api.deepseek.com/beta`.

**Arrancar:**

```bash
docker compose up postgres -d   # Postgres local en el puerto 5440
npm run dev                     # API en :9000 (migra y siembra sola) + web en http://localhost:8080
```

Entra con `test@example.com` / `TestPass123!`; el usuario ya existe en Cognito. Si no existe,
créalo con `./backend/scripts/create_test_user.sh`.

Dos manías del entorno:

- **No hagas commit de `frontend/AGENTS.md`**; `next dev` lo genera.
- **Revierte `frontend/tsconfig.json`** si `next dev` lo ha cambiado: `git checkout frontend/tsconfig.json`.

## 3. Cómo probar el bloque 1 (la prueba a mano)

**Dónde:** http://localhost:8080/dashboard → **Nueva receta**. Haz cada prueba también una vez
con el navegador estrecho: DevTools → modo dispositivo → 360 px.

**Qué buscar:** no solo que funcione. Busca lo que **chirríe** al ir y venir editando, y apúntalo
en la tabla de la sección 3.2.

### 3.1 Guion

**A. Pegar texto.** "Pegar el texto", pega esto y lee:

```text
Lentejas con chorizo (4 personas)

- 400 g de lentejas pardinas
- 4 patatas
- 1 cebolla grande picada
- 2 zanahorias
- 1 chorizo
- 1 morcilla (opcional)
- 2 dientes de ajo
- 1 hoja de laurel
- 1 cucharadita de pimentón
- sal y pimienta
- aceite de oliva

Sofríe la cebolla, el ajo y el pimiento en el aceite. Añade el pimentón, las lentejas,
las patatas y la zanahoria, cubre de agua y cuécelo 12 minutos en la olla exprés.
Sirve con el chorizo y la morcilla en rodajas.
```

Qué debería pasar (tarda unos 4 s):

- **Contador:** "11 líneas → 12 ingredientes", porque sal y pimienta salen separadas, o hay un
  botón "Separar" para hacerlo.
- **Debajo de cada fila,** "de: …" con la línea original.
- **Patatas** ofrecen "Usar ≈ N g", y aceptarlo las pasa a g.
- **Morcilla** marcada "Opcional".
- **Ingrediente nuevo:** si no está en el catálogo, sale "✦ nuevo". No se guarda nada en el
  catálogo hasta pulsar Guardar.
- **Aviso:** los pasos nombran "pimiento" y la lista no lo tiene. El aviso trae un botón "Añadir".
- **Raciones:** 4, con la marca "del texto".
- **Etiquetas propuestas:** probablemente tupper y olla exprés, y ⚡ rápida si los tiempos suman
  30 min o menos.
- **Texto original:** al lado en pantalla ancha, desplegable en el móvil.

**B. El ida y vuelta (lo más importante).** Sobre esa misma receta:

1. Borra una fila → el contador dice "(1 quitada por ti)".
2. Cambia el nombre de un ingrediente nuevo → desaparece "✦ nuevo" si ya no coincide; si escribes
   algo del catálogo, salen sugerencias mientras escribes.
3. Cambia raciones de 4 a 2 → las cantidades se dividen entre dos. Debajo aparece "No, las
   cantidades ya eran para 2", que las devuelve y deja el 2.
4. Cambia raciones varias veces seguidas y deshaz → vuelven a las de antes del primer cambio.
5. Edita el texto original (por ejemplo, borra la zanahoria y añade "200 g de calabaza") →
   "Volver a leer" enseña "Añade: calabaza · Quita: zanahoria" **antes** de sustituir tus filas,
   y eliges "Usar la nueva lectura" o "Quedarme con la mía".
6. Marca y desmarca "Opcional" en otra fila.
7. Pulsa Cancelar o atrás con cambios → pregunta "¿Salir sin guardar?". Sin cambios, sale
   directo. Cerrar la pestaña también avisa.
8. Guarda. Abre la receta → se ven etiquetas, tiempos e ingredientes opcionales.

**C. Enlace.** "Desde un enlace" con una receta de bbcgoodfood.com, que tiene datos
estructurados.

- Título, raciones y tiempos salen de la página (~5 s).
- Un enlace roto o sin receta dice "No hemos podido leer esa página…" y ofrece "Escribirla yo".

**D. Foto.** "Desde una foto" de una página de libro o de una receta escrita a mano.

- Unos 3 s.
- La foto no se guarda en ningún sitio.
- Una sopa o una crema no debería salir como "tupper".

**E. Receta sencilla.** "Receta sencilla", sin IA. Crea "Ensalada con carne":

- Raciones: 1, "por persona".
- Fijos: 150 g de carne, queso, aceitunas, tomate.
- **Opcionales:** maíz, cebolla.
- Sin pasos; "Añadir pasos" los abre si quieres.
- Se guarda como "Solo vuestra cocina", con un candado en el recetario.
- Otra cuenta de **otra** cocina no la ve: le da 404.

**F. Editar una receta existente.** Abre una de las 14 sembradas → Editar.

- Las filas se emparejan con el catálogo.
- Cambiar raciones escala y se puede deshacer igual que al crear.

**G. En el plan y la lista.**

- **Opcionales:** pon la ensalada en una comida → "Añadir a la lista" → el maíz y la cebolla
  salen **desmarcados**.
- **g y kg:** dos recetas con 500 g y 1 kg del mismo producto → **una** línea en la lista, "1,5 kg".

**H. Idiomas.** Cambia a catalán y a inglés en el perfil y repasa la pantalla de añadir receta.
Nada se corta y no hay textos sin traducir.

### 3.2 Resultados (rellenar al probar)

| Prueba | ¿Bien? | Qué chirría / qué cambiar |
|---|---|---|
| A. Pegar texto | | |
| B. Ida y vuelta | | |
| C. Enlace | | |
| D. Foto | | |
| E. Receta sencilla | | |
| F. Editar existente | | |
| G. Plan y lista | | |
| H. Idiomas / móvil | | |
| ¿Flash basta, o hace falta un modelo más caro? | | |

## 4. Después de la prueba, en este orden

1. **Ajustes** de lo que salga en 3.2, en esta misma rama, con sus tests.

2. **Subir la rama y abrir el PR.** Lo haces tú:

   ```bash
   git push -u origin feat-recipes-block-1
   gh pr create --base main --title "Phase 1, block 1: recipes from text, link or photo; simple recipes; tags; g/ml"
   ```

3. **Firewall, antes de mergear.** `/recipes/import` llama a DeepSeek, que cuesta dinero, así que
   entra en la regla "Rate limit paid endpoints" (100 peticiones / 10 min por IP). La regla está
   documentada en [docs/wiki/ci-cd.md](docs/wiki/ci-cd.md#firewall-sam-api).

   - Desde `backend/`: primero
     `npx vercel@65.16.0 firewall rules inspect "Rate limit paid endpoints" --expand`.
   - Luego `rules edit` con **todas** las condiciones, porque `--condition` sustituye las que
     había: empieza por `/places/` **o** es igual a `/ingredients/parse` **o** es igual a
     `/recipes/import`.
   - Revisa con `firewall diff` y publica con
     `--confirm-name sam-api --effects-digest <digest>`.
   - Actualiza la tabla de `ci-cd.md`.

4. **Mergear.** Vercel despliega y en el build corren dos migraciones:

   - `b6e2d4f8a1c3`: campos nuevos de receta (tags, visibility, kitchen_id).
   - `c3f9a1d7e605`: pasa a g y ml las 4 líneas de lista que hay en kg o l: carne 1 kg,
     lentejas 1 kg, caldo de carne 1 l y caldo de verduras 4 l. Comprobado: ninguna se junta
     con otra.

   No hace falta ninguna variable de entorno nueva; usa el `DEEPSEEK_API_KEY` que ya está.

5. **Comprobar producción:** añade una receta pegando texto en sam-web-zeta.vercel.app.

6. **Reimportar las recetas reales** en producción y comparar con las que había.

7. **Etiquetar las recetas existentes:** una pasada única donde la IA propone y una persona revisa.

8. **Pasar `/ingredients/parse` a `deepseek-flash`:** cambia `LLM_PRIMARY_MODEL` en Vercel y
   en `.env.example`. Luego marca las casillas que quedan en la spec.

9. **Bloque 2 — el plan.** Diseñarlo con la receta sencilla ya probada en la mano. Lo ya decidido
   y lo que queda por iterar está en
   [meal-plan-phase-1.md § Block 2](docs/plans/meal-plan-phase-1.md#block-2--the-plan-designed-after-block-1-is-tried):

   - "No comemos en casa" como botón.
   - Una sola búsqueda de recetas y productos.
   - "Ensalada con carne" como receta sencilla o como productos sueltos.
   - Productos con tienda.

   Después de 2–3 sábados usándolo, medir con SQL de solo lectura contra las semanas anteriores,
   con la tabla de métricas de la spec.

## 5. Dónde está cada cosa en el código

| Pieza | Archivos |
|---|---|
| Modelo de receta (tags, visibility, optional) | `backend/src/domain/entities/recipe.py`, migraciones en `backend/alembic/versions/` |
| Importar (texto / enlace / foto) | `backend/src/app/use_cases/import_recipe.py`, `backend/src/infra/adapters/parsing/recipe_prompt.py` + `recipe_reader.py`, `backend/src/infra/adapters/recipe_pages/`, `backend/src/infra/controllers/recipe_import_controller.py` |
| g/ml en la lista | `backend/src/domain/entities/shopping_list.py` (`canonical_unit`) |
| Catálogo escrito solo al guardar | `backend/src/app/use_cases/remember_groceries.py` |
| Pantalla de inicio (4 formas de empezar) | `frontend/components/recipes/RecipeStart.tsx` |
| Formulario y revisión | `frontend/components/RecipeForm.tsx`, `frontend/components/recipes/IngredientReview.tsx`, `ServingsField.tsx`, `TagPicker.tsx` |
| Reglas de las filas (escalar, separar, contar, comparar) | `frontend/lib/recipe-review.ts` (+ `.spec.ts`) |
| Etiquetas e iconos | `frontend/lib/recipe-tags.ts` |
| Textos | `frontend/messages/{en,es,ca}.json`: secciones `recipe-start`, `recipe-tags`, `recipe-form` |

## 6. Otras cosas pendientes (no de esta feature)

- Revocar el token personal de GitHub que usaba Amplify.
- Móviles: usar sam-web-zeta.vercel.app, volver a iniciar sesión, añadirla a la pantalla de
  inicio y quitar el icono viejo de Amplify.
- Dependabot: 66 alertas (8 críticas) y los PRs #112–#115 y #71 abiertos.
- La skill de diseño Impeccable tiene versión nueva (v4.9.1): `npx impeccable update`.
