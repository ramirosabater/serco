# Pasar las novedades del Access y validar la migración (hito 1)

Serco sigue cargando en el Access hasta que el sistema nuevo entre en producción. Antes de arrancar se traen los días que faltan, se suben los PDF y se valida que esté todo.

## 1. Lo que hace Claude

Con el Access actualizado (`SGRP.mdb`):

- Arma **`novedades-AAAA-MM-DD.sql.gz`** comparando el Access de la carga inicial con el nuevo:
  - trae lo dado de alta después (manifiestos, residuos, Manifiestos Nación, certificados, generadores, flota);
  - actualiza **solo los campos que cambiaron en el Access** (por ejemplo, un residuo que pasó a dispuesto o un vencimiento renovado);
  - lo editado en el sistema nuevo se conserva, salvo que en el Access también haya cambiado ese mismo campo;
  - lo que se borró del Access no se borra: queda listado en el resumen (`novedades-AAAA-MM-DD.txt`).
- Arma **`esperado-AAAA-MM-DD.json`**: las cifras de control del Access nuevo, leídas directamente del .mdb.

## 2. Lo que hacés vos (en esta carpeta, en PowerShell)

Una sola vez: `pip install psycopg2-binary openpyxl`

```
python aplicar_novedades.py novedades-AAAA-MM-DD.sql.gz
```

Pide la dirección de la base (no se ve mientras la pegás ni queda en el historial): Supabase → **Connect** → **Session pooler**, cambiando `[YOUR-PASSWORD]` por la contraseña de la base. Muestra cuántas filas agrega y cambia y pide que escribas `APLICAR`. Si algo falla, la base queda como estaba. Se puede correr dos veces sin duplicar nada.

Si algún número de manifiesto del Access ya se usó en el sistema nuevo (una prueba de emisión), antes de aplicar lo muestra y pregunta: escribí `REEMPLAZAR` para borrar esos de prueba y traer los reales del Access. Mientras Serco cargue en el Access, el Access manda.

Después, la validación:

```
python ..\validar\validar.py esperado-AAAA-MM-DD.json
```

Solo lee la base. Deja **`validacion-migracion-AAAA-MM-DD.xlsx`** junto al JSON, con:

| Hoja | Qué tiene |
| --- | --- |
| Resumen | Cada control con OK o Revisar |
| Cantidades por tabla | Registros del Access contra el sistema nuevo |
| Manifiestos por año · Residuos por año | Año por año, con kilos y litros por estado |
| Por generador · Por corriente | Lo retirado a cada generador y de cada corriente |
| Faltantes | Formularios que están de un lado y no del otro |
| Inconsistencias (y detalle) | Lo que la migración encontró en el Access y cómo se resolvió |
| Archivos | PDF enlazados, encontrados y subidos |

Ese Excel es el informe del hito 1.

## 3. Los PDF

Se suben con `migracion/migrar_archivos.py` cuando estén las carpetas del Access (RAYGROUP). Después se vuelve a correr `validar.py` y la hoja Archivos muestra los subidos.

> Los `.json`, `.xlsx` y `.sql.gz` tienen datos de Serco: no van a GitHub (están en el `.gitignore`).
