#!/usr/bin/env python3
"""
SGRP 2.0 · Cifras de control del Access, para validar la migración (hito 1).

Lee el .mdb directamente, sin pasar por migrar.py, y calcula lo que el sistema nuevo
tiene que tener: cantidades por tabla, kilos/litros por año, estado y unidad, por
generador y por corriente, y la lista de manifiestos, Manifiestos Nación y certificados.

Uso:
    python esperado.py ruta/SGRP.mdb esperado.json

El JSON resultante no tiene datos personales: solo números de formulario, códigos y totales.
Se compara contra la base con puesta-en-marcha/validar/validar.py.
"""
import csv, io, json, re, subprocess, sys
from collections import defaultdict
from datetime import datetime

csv.field_size_limit(10**8)


def leer(mdb, tabla):
    out = subprocess.run(['mdb-export', mdb, tabla], capture_output=True, check=True).stdout
    return list(csv.DictReader(io.StringIO(out.decode('utf-8', 'replace'))))


def txt(v):
    if v is None: return None
    v = re.sub(r'\s+', ' ', str(v)).strip()
    return v or None


def anio(v):
    v = txt(v)
    try: return str(datetime.strptime(v, '%m/%d/%y %H:%M:%S').year) if v else 'sin fecha'
    except ValueError: return 'sin fecha'


def fecha(v):
    v = txt(v)
    try: return datetime.strptime(v, '%m/%d/%y %H:%M:%S').date().isoformat() if v else None
    except ValueError: return None


def num(v):
    try: return float(txt(v) or 0)
    except ValueError: return 0.0


# Mismas equivalencias que usa la migración (se documentan en el informe)
ESTADOS = {'Almacenado': 'almacenado', 'En Transito': 'en_transito', 'Disposición Final': 'disposicion_final'}
def estado(v): return ESTADOS.get(txt(v), 'almacenado')
def um(v):
    v = (txt(v) or '').upper()
    return v if v in ('KGS', 'LTS', 'MS3') else 'KGS'


def calcular(mdb):
    man = leer(mdb, 'Manifiestos')
    det = leer(mdb, 'ManifiestoDet')
    fecha_man = {f"{r['IdManifiesto']}|{r['IdNroTransp']}": r['FchaAltaManif'] for r in man}
    cli_man = {f"{r['IdManifiesto']}|{r['IdNroTransp']}": r['IdClientes'] for r in man}

    por_anio = defaultdict(lambda: {'residuos': 0, 'cantidad': 0.0})
    por_generador = defaultdict(lambda: {'residuos': 0, 'KGS': 0.0, 'LTS': 0.0, 'MS3': 0.0})
    por_corriente = defaultdict(lambda: {'residuos': 0, 'KGS': 0.0, 'LTS': 0.0, 'MS3': 0.0})
    for r in det:
        k = f"{r['IdManifiesto']}|{r['IdNroTransp']}"
        a, u, e, c = anio(fecha_man.get(k)), um(r['IdMedida']), estado(r['EstadoDetManif']), num(r['Cantidad'])
        x = por_anio[f'{a}|{e}|{u}']; x['residuos'] += 1; x['cantidad'] += c
        g = por_generador[str(int(cli_man[k])) if k in cli_man else 'sin manifiesto']; g['residuos'] += 1; g[u] += c
        co = por_corriente[txt(r['IdCorriente']) or 'sin corriente']; co['residuos'] += 1; co[u] += c

    man_por_anio = defaultdict(int)
    for r in man: man_por_anio[anio(r['FchaAltaManif'])] += 1

    conteos = {
        'manifiestos': len(man),
        'manifiesto_items': len(det),
        'manifiestos_nacion': len(leer(mdb, 'ManifTransNacion')),
        'certificados': len(leer(mdb, 'CertificadosDispFinal')),
        'generadores': len(leer(mdb, 'Clientes')),
        'generadores_principales': len(leer(mdb, 'Generador Principal')),
        'transportistas': len(leer(mdb, 'Transporte')),
        'camiones': len(leer(mdb, 'Camiones')),
        'choferes': len(leer(mdb, 'Choferes')),
        'operadores': len(leer(mdb, 'OperadorDispFinal')),
        'corrientes': len(leer(mdb, 'Corrientes')),
    }
    fechas = [fecha(r['FchaAltaManif']) for r in man if fecha(r['FchaAltaManif'])]
    redondear = lambda d: {k: {kk: round(vv, 3) if isinstance(vv, float) else vv for kk, vv in v.items()} for k, v in d.items()}
    return {
        'generado': datetime.now().isoformat(timespec='seconds'),
        'access': {'archivo': mdb.split('/')[-1], 'desde': min(fechas), 'hasta': max(fechas)},
        'conteos': conteos,
        'manifiestos_por_anio': dict(sorted(man_por_anio.items())),
        'residuos_por_anio': redondear(dict(sorted(por_anio.items()))),
        'por_generador': redondear(dict(por_generador)),
        'por_corriente': redondear(dict(sorted(por_corriente.items()))),
        'claves': {
            'manifiestos': sorted(f"{txt(r['IdManifiesto'])}|{int(r['IdNroTransp'])}" for r in man),
            'manifiestos_nacion': sorted({txt(r['IdManTraNac']) for r in leer(mdb, 'ManifTransNacion')} - {None}),
            'generadores': sorted(int(r['IdClientes']) for r in leer(mdb, 'Clientes')),
        },
    }


if __name__ == '__main__':
    if len(sys.argv) < 3: sys.exit(__doc__)
    datos = calcular(sys.argv[1])
    with open(sys.argv[2], 'w', encoding='utf-8') as f:
        json.dump(datos, f, ensure_ascii=False)
    c = datos['conteos']
    print(f"Access del {datos['access']['desde']} al {datos['access']['hasta']}: "
          f"{c['manifiestos']} manifiestos, {c['manifiesto_items']} residuos, {c['certificados']} certificados → {sys.argv[2]}")
