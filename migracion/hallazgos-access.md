# Hallazgos de la migración del Access · 06/10/2026

Base: SGRP.mdb (Jet 4, 165 MB, 33 tablas). Corrida completa en una base de prueba.

## Conteos

| Tabla | Access | Sistema nuevo |
| --- | ---: | ---: |
| Manifiestos | 29.853 | 29.853 |
| Residuos (detalle) | 30.908 | 30.908 |
| Manifiestos Nación | 7.628 | 7.628 |
| Certificados | 7.650 | 7.650 |
| Generadores | 657 | 657 |
| Generadores principales (plantas) | 18 | 18 |
| Transportistas | 18 | 18 |
| Camiones | 66 | 66 |
| Choferes | 50 | 59 (9 recuperados de manifiestos) |
| Operadores | 13 | 13 |
| Corrientes | 38 | 39 (1 recuperada de manifiestos) |

Los kilos y litros por estado coinciden exactamente con el Access.
Historia desde el 03/11/2010 hasta el 25/09/2026. Archivos referenciados: 45.217.

## Lo que hay que hablar con Serco

1. **Residuos "almacenados" desde hace años.** 8.781 residuos de manifiestos anteriores a 2026 siguen
   como almacenados (unas 12.000 t y 20 millones de litros, desde 2011). Nunca se actualizó el estado.
   Hay que decidir cómo cerrarlos antes del arranque; si no, el armado de cargas y los plazos no sirven.
2. **Anulados:** el Access los marcaba escribiendo "ANULADO" en el chofer o la dirección (1.097).
   Se migran como anulados. Quedan 5 manifiestos sin residuos que no dicen ANULADO y 1 anulado con residuos.
3. **991 manifiestos sin generador principal** (883 con valor 0 y 108 vacíos).
4. **Certificados y Nación que no enlazan:** 107 residuos apuntan a un certificado inexistente y 70 a un
   Manifiesto Nación inexistente. 19 certificados no tienen residuos.
5. **Generadores:** 17 CUIT inválidos, 4 sin CUIT, 71 que comparten CUIT y 8 nombres duplicados.
6. **Usuarios:** 7 en el Access, con contraseñas sin cifrar. Se crean de nuevo con un mail por persona.
7. **Vencimientos:** con los datos del Access no se puede emitir: todos los camiones y choferes de
   Serco Ambiental tienen algo vencido o sin cargar, y la habilitación provincial de Serco Ambiental
   figura vencida desde el 25/08/2026. Hay que cargar los vencimientos actualizados antes del uso en paralelo.
8. **Habilitaciones de generadores:** de los ~140 con retiros en el último año, 129 no tienen la municipal
   cargada y 9 la tienen vencida. Quedó como parámetro (`bloquear_generador`): bloquear o solo avisar.
9. **Bajas con trucos:** un chofer llamado "ANULADO_" (se migra dado de baja) y patentes con guion bajo
   ("MVD143_", "IUM534_"). Choferes con el nombre mal escrito ("MALO JOTGE", "MALOJ JORGE"): se pueden unificar.
10. **Numeración del Manifiesto Nación:** usa números de la misma serie 837 que los manifiestos.
    ¿El formulario verde trae su propio número preimpreso?
11. **Corrientes de operadores:** ningún operador está habilitado para las 7 corrientes que hoy hay en planta
    de Serco Ambiental. Conviene revisar las corrientes habilitadas de cada operador en Altas.

12. **Mails de los generadores:** de los 139 generadores con retiros en el último año, solo 41 tienen mail.
    Sin mail no hay aviso automático del certificado: hay que pedirlos y cargarlos en Altas.

## Cosas del Access que cambian lo que sabíamos

- Serco opera con dos transportistas: SERCO SRL (manifiestos 162/161…) y SERCO AMBIENTAL SA (837…).
- El número de manifiesto se repite entre transportistas (un caso: 837003956).
- El "Generador principal" es la planta que recibe (Serco, Quimiguay, Ineco…).
- Los residuos guardan el RPGyOSP 734 y un número de certificado propio: probablemente los certificados RPGyOSP.
- Los instructivos por manifiesto (inhalación, dérmica…) están vacíos en los 29.853.

## Archivos

- Una carpeta por tipo y el nombre es el número del documento. Manifiestos y Nación: 100 % exacto.
- Certificados: número con prefijo por operador ("Quimi-", "Ineco ", "Seres ") en el 100 % de los casos.
- Las rutas no guardan la extensión. Habilitaciones (~130): nombre libre; algunas apuntan a `C:\`.
