#!/usr/bin/env python3
"""
SGRP 2.0 · Migración Access (SGRP.mdb) → Supabase/Postgres · borrador v0.1

Uso:
    export DATABASE_URL="postgresql://postgres:<clave>@<host>:5432/postgres"
    python migrar.py ruta/SGRP.mdb

Requiere: mdbtools (mdb-export) y psycopg2.
Vacía las tablas de datos y vuelve a cargar todo: se puede correr las veces que haga falta.
Cada problema encontrado queda en migracion_inconsistencias (informe del hito 1).
"""
import csv, io, os, re, subprocess, sys, unicodedata, json
from collections import Counter
from datetime import datetime

import psycopg2
from psycopg2.extras import execute_values, Json

csv.field_size_limit(10**8)

# ----------------------------------------------------------------------------- lectura
def leer(mdb, tabla):
    out = subprocess.run(['mdb-export', mdb, tabla], capture_output=True, check=True).stdout
    return list(csv.DictReader(io.StringIO(out.decode('utf-8', 'replace'))))

def txt(v):
    if v is None: return None
    v = re.sub(r'\s+', ' ', str(v).replace('\r', ' ').replace('\n', ' ')).strip()
    return v or None

def nombre_chofer(v):
    v = txt(v)
    if not v: return v
    mitad = len(v) // 2                     # "MALO JORGE MALO JORGE" → "MALO JORGE"
    if len(v) % 2 == 1 and v[:mitad] == v[mitad + 1:]: return v[:mitad]
    return v

def fecha(v):
    v = txt(v)
    if not v: return None
    try: return datetime.strptime(v, '%m/%d/%y %H:%M:%S').date()
    except ValueError: return None

def num(v):
    v = txt(v)
    if v is None: return None
    try: return float(v)
    except ValueError: return None

def entero(v):
    n = num(v)
    return int(n) if n is not None else None

def activo(v):                           # A = alta, B = baja
    return (txt(v) or 'A').upper() != 'B'

def um(v):
    v = (txt(v) or '').upper()
    return v if v in ('KGS', 'LTS', 'MS3') else None

def sin_acentos(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')

def estado_fisico(v):
    k = sin_acentos(txt(v) or '').upper().replace(' ', '')
    return {'SOLIDO': 'SÓLIDO', 'LIQUIDO': 'LÍQUIDO', 'SEMISOLIDO': 'SEMISÓLIDO'}.get(k, txt(v))

ESTADOS = {'Almacenado': 'almacenado', 'En Transito': 'en_transito', 'Disposición Final': 'disposicion_final'}

def cuit_valido(c):
    if not c or not re.fullmatch(r'\d{11}', c): return False
    s = sum(int(a) * b for a, b in zip(c, [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]))
    v = 11 - s % 11
    v = {11: 0, 10: 9}.get(v, v)
    return v == int(c[10])

def carpeta_raygroup(ruta):            # \\USUARIO-PC\...\RAYGROUP\CertDispFinal\Quimi-0000005 → CertDispFinal
    partes = re.split(r'[\\/]', ruta)
    up = [p.upper() for p in partes]
    if 'RAYGROUP' in up and up.index('RAYGROUP') + 2 < len(partes):
        return partes[up.index('RAYGROUP') + 1]
    return None

def es_anulado(r):                      # el Access marcaba los anulados escribiendo ANULADO en el chofer o la dirección
    return any('ANULAD' in (txt(r.get(c)) or '').upper() for c in ('IdChofer', 'RetiroDirec', 'NotaManif'))

def clave(s):                            # para comparar nombres sin mayúsculas, acentos ni puntos
    return re.sub(r'[^A-Z0-9]', '', sin_acentos((s or '').upper()))

# ----------------------------------------------------------------------------- migración
class Migracion:
    def __init__(self, mdb, dsn):
        self.mdb = mdb
        self.db = psycopg2.connect(dsn)
        self.cur = self.db.cursor()
        self.incons = []
        self.archivos = set()

    def anotar(self, tabla, clave_access, resultado, problema, detalle=None):
        self.incons.append((tabla, clave_access, resultado, problema, Json(detalle) if detalle else None))

    def archivo(self, ruta):
        ruta = txt(ruta)
        if ruta: self.archivos.add(ruta)
        return ruta

    def insertar(self, tabla, cols, filas, devolver=None):
        if not filas: return []
        sql = f'insert into {tabla} ({",".join(cols)}) values %s'
        if devolver: sql += f' returning {devolver}'
        return execute_values(self.cur, sql, filas, page_size=1000, fetch=bool(devolver))

    def correr(self):
        c = self.cur
        # Con las reglas ya aplicadas, la carga masiva no dispara validaciones ni historial
        try:
            c.execute('set session_replication_role = replica')
        except psycopg2.Error:
            self.db.rollback()
            print('Aviso: sin permiso para desactivar triggers; correr sobre una base sin las reglas (0002 y 0004).')
        # Las validaciones "not valid" de 0002/0004 se exigen en cada insert: se sacan durante la carga y se vuelven a poner
        c.execute("""select conrelid::regclass::text, conname, pg_get_constraintdef(oid) from pg_constraint
                     where contype = 'c' and not convalidated and connamespace = 'public'::regnamespace""")
        reglas = c.fetchall()
        for tabla, nombre, _ in reglas: c.execute(f'alter table {tabla} drop constraint {nombre}')
        c.execute("""truncate manifiesto_items, certificados, manifiestos_nacion, manifiestos,
                     planta_corrientes, transportista_corrientes, operador_corrientes, corrientes,
                     choferes, camiones, transportistas, operadores, generador_direcciones, generadores,
                     generadores_principales, ciudades, provincias, actividades, parametros,
                     migracion_archivos, historial restart identity cascade""")
        c.execute('insert into migracion_corridas default values returning id')
        self.corrida = c.fetchone()[0]
        conteo = {}

        # --- catálogos
        prov = {txt(r['Provincia']) for r in leer(self.mdb, 'Provincia')} - {None}
        self.insertar('provincias', ['nombre'], [(p,) for p in sorted(prov)])
        ciu = []
        for r in leer(self.mdb, 'Ciudad'):
            p = txt(r['Provincia'])
            if p and p not in prov:
                self.insertar('provincias', ['nombre'], [(p,)]); prov.add(p)
            ciu.append((txt(r['Ciudad']), p, txt(r['CP'])))
        self.insertar('ciudades', ['nombre', 'provincia', 'cp'], ciu)
        self.insertar('actividades', ['nombre'], [(txt(r['Actividad']),) for r in leer(self.mdb, 'Actividad')])
        for r in leer(self.mdb, 'RPGLibro'):
            self.insertar('parametros', ['clave', 'valor', 'descripcion'], [
                ('rpgyosp_serco', txt(r['RPGyOSP']), 'Número RPGyOSP de Serco como operador'),
                ('proximo_cert_rp', txt(r['RPCertNro']), 'Próximo número de certificado RPGyOSP')])

        # --- generadores principales
        gp = leer(self.mdb, 'Generador Principal')
        ids = self.insertar('generadores_principales',
            ['id_access', 'nombre', 'cuit', 'direccion', 'ciudad', 'cp', 'provincia', 'telefono', 'ubicacion', 'email',
             'hab_nac_nro', 'hab_nac_vto', 'hab_pro_nro', 'hab_pro_vto', 'hab_mun_nro', 'hab_mun_vto',
             'hab_nac_archivo', 'hab_pro_archivo', 'hab_mun_archivo'],
            [(int(r['IdGenerador']), txt(r['GeneradorNombre']), txt(r['GeneradorCuit']), txt(r['GeneradorDirección']),
              txt(r['GeneradorCiudad']), txt(r['GeneradorCP']), txt(r['GeneradorProvincia']), txt(r['GeneradorTelefono']),
              txt(r['GeneradorUbicacion']), txt(r['GeneradorEmail']),
              txt(r['GeneradorNroHab']), fecha(r['GeneradorVtoHab']), txt(r['GeneradorNroHabPro']), fecha(r['GeneradorVtoHabPro']),
              txt(r['GeneradorNroHabMun']), fecha(r['GeneradorVtoHabMun']),
              self.archivo(r['GeneradorHabNac']), self.archivo(r['GeneradorHabPro']), self.archivo(r['GeneradorHabMun']))
             for r in gp], devolver='id, id_access')
        self.gp = {a: i for i, a in ids}
        conteo['generadores_principales'] = (len(gp), len(ids))

        # --- generadores (clientes)
        cl = leer(self.mdb, 'Clientes')
        cuits = Counter(txt(r['Cuit']) for r in cl if txt(r['Cuit']))
        nombres = Counter(clave(r['NombreCompañía']) for r in cl)
        filas = []
        for r in cl:
            cuit, ida = txt(r['Cuit']), int(r['IdClientes'])
            if not cuit: self.anotar('Clientes', ida, 'revisar', 'Generador sin CUIT', {'nombre': txt(r['NombreCompañía'])})
            elif not cuit_valido(cuit): self.anotar('Clientes', ida, 'revisar', 'CUIT con dígito verificador inválido', {'cuit': cuit, 'nombre': txt(r['NombreCompañía'])})
            if cuit and cuits[cuit] > 1: self.anotar('Clientes', ida, 'revisar', 'CUIT repetido en otro generador', {'cuit': cuit, 'nombre': txt(r['NombreCompañía'])})
            if nombres[clave(r['NombreCompañía'])] > 1: self.anotar('Clientes', ida, 'revisar', 'Generador duplicado (mismo nombre)', {'nombre': txt(r['NombreCompañía'])})
            gpa = entero(r['GenePrin'])
            if gpa and gpa not in self.gp: self.anotar('Clientes', ida, 'migrado_sin_enlace', 'Generador principal inexistente', {'GenePrin': gpa})
            filas.append((ida, txt(r['NombreCompañía']) or f'Cliente {ida}', cuit, txt(r['CodIva']), txt(r['Actividad']), txt(r['Dirección']),
                          txt(r['Ciudad']), txt(r['Provincia']), txt(r['CódPostal']), txt(r['NombreContacto']), txt(r['ApellidosContacto']),
                          txt(r['CargoContacto']), txt(r['NúmTeléfono']), txt(r['Núm Celular']), txt(r['NúmFax']),
                          txt(r['DirCorreoElectrónico']), txt(r['Notas']), fecha(r['Fecha Alta']), txt(r['ModoRetiro']), self.gp.get(gpa),
                          txt(r['CliNroHabMun']), fecha(r['CliVtoHabMun']), self.archivo(r['CliImaHabMun']),
                          txt(r['CliNroHabCom']), fecha(r['CliVtoHabCom']), self.archivo(r['CliImaHabCom'])))
        ids = self.insertar('generadores',
            ['id_access', 'nombre', 'cuit', 'cod_iva', 'actividad', 'direccion', 'ciudad', 'provincia', 'cp', 'contacto_nombre',
             'contacto_apellido', 'contacto_cargo', 'telefono', 'celular', 'fax', 'email', 'notas', 'alta', 'modo_retiro',
             'generador_principal_id', 'hab_mun_nro', 'hab_mun_vto', 'hab_mun_archivo', 'hab_com_nro', 'hab_com_vto', 'hab_com_archivo'],
            filas, devolver='id, id_access')
        self.cli = {a: i for i, a in ids}
        conteo['generadores'] = (len(cl), len(ids))

        dirs, vistos = [], set()
        for r in leer(self.mdb, 'ClientesDirecciones'):
            g, d = self.cli.get(int(r['IdClientes'])), txt(r['DireccionDeRetiro'])
            if not g or not d or (g, d) in vistos: continue
            vistos.add((g, d)); dirs.append((g, d, txt(r['Ciudad']), txt(r['Provincia']), txt(r['CódPostal'])))
        self.insertar('generador_direcciones', ['generador_id', 'direccion', 'ciudad', 'provincia', 'cp'], dirs)

        # --- transportistas
        tr = leer(self.mdb, 'Transporte')
        man = leer(self.mdb, 'Manifiestos')
        emisores = {'SERCO SRL', 'SERCO AMBIENTAL SA'}
        ids = self.insertar('transportistas',
            ['id_access', 'nombre', 'cuit', 'direccion', 'localidad', 'provincia', 'cp', 'telefono', 'email',
             'hab_nac_nro', 'hab_nac_vto', 'hab_pro_nro', 'hab_pro_vto', 'hab_mun_nro', 'hab_mun_vto',
             'hab_nac_archivo', 'hab_pro_archivo', 'hab_mun_archivo', 'ret_env_amb', 'emite_manifiestos', 'proximo_numero', 'activo'],
            [(int(r['IdNroTransp']), txt(r['IdTransporte']), txt(r['CuitTrans']), txt(r['DireccTransp']), txt(r['LocalidadTransp']),
              txt(r['ProvinciaTransp']), txt(r['CPTransp']), txt(r['TelefonoTransp']), txt(r['emailTransp']),
              txt(r['TransNroHabNac']), fecha(r['TransVtoHabNac']), txt(r['TransNroHabPro']), fecha(r['TransVtoHabPro']),
              txt(r['TransNroHabMun']), fecha(r['TransVtoHabMun']),
              self.archivo(r['HabNacTransp']), self.archivo(r['HabPciaTransp']), self.archivo(r['HabMunTransp']),
              txt(r['RetEnvAmb']), txt(r['IdTransporte']) in emisores, entero(r['TransNroManif']) or None, activo(r['transporteActivo']))
             for r in tr], devolver='id, id_access, emite_manifiestos')
        self.tr = {a: i for i, a, _ in ids}
        self.tr_emite = {a: e for _, a, e in ids}
        conteo['transportistas'] = (len(tr), len(ids))

        # --- camiones
        ca = leer(self.mdb, 'Camiones')
        ids = self.insertar('camiones',
            ['transportista_id', 'patente', 'ruta_archivo', 'ruta_vto', 'titulo_archivo', 'cedula_archivo', 'rastreo_archivo',
             'vtv_vto', 'vtv_archivo', 'carga_pel_nro', 'carga_pel_vto', 'carga_pel_archivo', 'activo'],
            [(self.tr[int(r['IdNroTransp'])], txt(r['IdPatente']).upper(), self.archivo(r['PatenteRuta']), fecha(r['PatenteRutaVto']),
              self.archivo(r['PatenteTitulo']), self.archivo(r['PatenteCedVerde']), self.archivo(r['PatenteRastreoSat']),
              fecha(r['PatenteVTVVto']), self.archivo(r['PatenteVTVImagen']), txt(r['PatenteCPeligNro']),
              fecha(r['PatenteCPeligVto']), self.archivo(r['PatenteCPeligImagen']), activo(r['CamionesActivo']))
             for r in ca], devolver='id, transportista_id, patente')
        self.cam = {(t, p): i for i, t, p in ids}
        conteo['camiones'] = (len(ca), len(ids))

        # --- choferes (más los que figuran en manifiestos y ya no están en la tabla)
        chs = leer(self.mdb, 'Choferes')
        filas, vistos = [], set()
        for r in chs:
            k = (self.tr[int(r['IdNroTransp'])], nombre_chofer(r['Chofer']))
            if k in vistos: continue
            vistos.add(k)
            nro = txt(r['NroCarnet'])
            filas.append((*k, None if nro in (None, '0') else nro, fecha(r['NroCarnetVto']), self.archivo(r['NroCarnetImagen']),
                          fecha(r['CCargaPeligVto']), self.archivo(r['CCargaPeligImagen']), fecha(r['SEPVto']),
                          self.archivo(r['SEPImagen']), activo(r['ChoferActivo']) and 'ANULAD' not in k[1].upper(), False))
        faltan = Counter()
        for r in man:
            if es_anulado(r): continue
            k = (self.tr.get(int(r['IdNroTransp'])), nombre_chofer(r['IdChofer']))
            if k[0] and k[1] and k not in vistos: faltan[k] += 1
        for k, n in faltan.items():
            vistos.add(k)
            filas.append((*k, None, None, None, None, None, None, None, False, True))
            self.anotar('Choferes', k[1], 'corregido', 'Chofer usado en manifiestos que no estaba en la tabla: se crea dado de baja', {'manifiestos': n})
        ids = self.insertar('choferes',
            ['transportista_id', 'nombre', 'carnet_nro', 'carnet_vto', 'carnet_archivo', 'carga_pel_vto', 'carga_pel_archivo',
             'sep_vto', 'sep_archivo', 'activo', 'creado_en_migracion'], filas, devolver='id, transportista_id, nombre')
        self.cho = {(t, n): i for i, t, n in ids}
        conteo['choferes'] = (len(chs), len(ids))

        # --- operadores
        ops = leer(self.mdb, 'OperadorDispFinal')
        ids = self.insertar('operadores',
            ['nombre', 'cuit', 'direccion', 'localidad', 'provincia', 'cp', 'telefono', 'email', 'ubicacion',
             'hab_nac_nro', 'hab_nac_vto', 'hab_pro_nro', 'hab_pro_vto', 'hab_mun_nro', 'hab_mun_vto',
             'hab_nac_archivo', 'hab_pro_archivo', 'hab_mun_archivo'],
            [(txt(r['IdOperadorDF']), txt(r['CuitODF']), txt(r['DirecciónODF']), txt(r['LocalidadODF']), txt(r['ProvinciaODF']),
              txt(r['CPODF']), txt(r['TelefonoODF']), txt(r['emailODF']), txt(r['UbicacionODF']),
              txt(r['NroHabNac']), fecha(r['VtoHabNac']), txt(r['HabProNroODF']), fecha(r['HabProVtoODF']),
              txt(r['HabMunNroODF']), fecha(r['HabMunVtoODF']),
              self.archivo(r['HabilitacionNacion']), self.archivo(r['HabProODF']), self.archivo(r['HabMunODF']))
             for r in ops], devolver='id, nombre')
        self.op = {clave(n): i for i, n in ids}
        conteo['operadores'] = (len(ops), len(ids))

        def operador(nombre, tabla, k):
            n = txt(nombre)
            if not n: return None
            i = self.op.get(clave(n))
            if i is None:
                self.anotar(tabla, k, 'migrado_sin_enlace', 'Operador inexistente', {'operador': n})
            return i

        # --- corrientes
        det = leer(self.mdb, 'ManifiestoDet')
        cos = leer(self.mdb, 'Corrientes')
        filas = [(txt(r['IdCorrientes']), txt(r['DescripCorrientes']), um(r['UM']), estado_fisico(r['EstadoCte']), False) for r in cos]
        existentes = {f[0] for f in filas}
        for cod, n in Counter(txt(r['IdCorriente']) for r in det if txt(r['IdCorriente']) not in existentes).items():
            filas.append((cod, None, None, None, True))
            self.anotar('Corrientes', cod, 'corregido', 'Corriente usada en manifiestos que no estaba en la tabla: se crea', {'items': n})
        ids = self.insertar('corrientes', ['codigo', 'descripcion', 'um', 'estado_fisico', 'creada_en_migracion'], filas, devolver='id, codigo')
        self.cor = {c: i for i, c in ids}
        conteo['corrientes'] = (len(cos), len(ids))

        pc = []
        for r in leer(self.mdb, 'GeneradorCorrientes'):
            g, co = self.gp.get(entero(r['IdGenerador'])), self.cor.get(txt(r['IdCorrientes']))
            if g and co: pc.append((g, co, um(r['UM'])))
            else: self.anotar('GeneradorCorrientes', f"{r['IdGenerador']}|{r['IdCorrientes']}", 'descartado', 'Habilitación de corriente para un generador principal inexistente')
        self.insertar('planta_corrientes', ['generador_principal_id', 'corriente_id', 'um'], pc)
        tc = [(self.tr[int(r['IdNroTransp'])], self.cor[txt(r['IdCorrientes'])], um(r['UM']))
              for r in leer(self.mdb, 'TransporteCorrientes') if int(r['IdNroTransp']) in self.tr and txt(r['IdCorrientes']) in self.cor]
        self.insertar('transportista_corrientes', ['transportista_id', 'corriente_id', 'um'], tc)
        oc = [(self.op[clave(r['IdOperadorDF'])], self.cor[txt(r['IdCorrientes'])])
              for r in leer(self.mdb, 'OperadorDispFinalCorrientes') if clave(r['IdOperadorDF']) in self.op and txt(r['IdCorrientes']) in self.cor]
        self.insertar('operador_corrientes', ['operador_id', 'corriente_id'], oc)

        # --- manifiestos Nación
        mtn = leer(self.mdb, 'ManifTransNacion')
        filas = []
        for r in mtn:
            k = txt(r['IdManTraNac'])
            gpa = entero(r['IdGenerador'])
            if gpa and gpa not in self.gp: self.anotar('ManifTransNacion', k, 'migrado_sin_enlace', 'Generador principal inexistente', {'IdGenerador': gpa})
            filas.append((k, fecha(r['FchaManTraNac']), self.tr.get(entero(r['IdNroTransp'])), self.gp.get(gpa),
                          operador(r['OperadorDF'], 'ManifTransNacion', k), txt(r['MnNroHabNac']), fecha(r['MnVtoHabNac']),
                          self.archivo(r['LogoManTraNac']), entero(r['NroUsrAlta'])))
        ids = self.insertar('manifiestos_nacion', ['numero', 'fecha', 'transportista_id', 'generador_principal_id', 'operador_id',
                                                   'hab_nac_nro', 'hab_nac_vto', 'escaneo', 'usuario_access'], filas, devolver='id, numero')
        self.mtn = {n: i for i, n in ids}
        conteo['manifiestos_nacion'] = (len(mtn), len(ids))

        # --- certificados
        cds = leer(self.mdb, 'CertificadosDispFinal')
        filas = []
        for r in cds:
            nro, mk = txt(r['NroCertDispFinal']), txt(r['IdManTraNac'])
            k = f'{nro}|{mk}'
            if mk and mk not in self.mtn: self.anotar('CertificadosDispFinal', k, 'migrado_sin_enlace', 'Certificado de un Manifiesto Nación inexistente')
            cte = txt(r['IdCte'])
            hab = {c: txt(r[c]) for c in ['ODFNroHabNac', 'GPNroHabNac', 'GPNroHabPro', 'GPNroHabMun'] if txt(r[c])}
            hab.update({c: str(fecha(r[c])) for c in ['ODFVtoHabNac', 'GPVtoHabNac', 'GPVtoHabPro', 'GPVtoHabMun'] if fecha(r[c])})
            tipo = (txt(r['CDFTipo']) or '').upper() or None
            filas.append((nro, self.mtn.get(mk), fecha(r['FechaCertificado']), operador(r['IdOperadorDF'], 'CertificadosDispFinal', k),
                          self.gp.get(entero(r['IdGenerador'])), self.cor.get(cte) if cte else None,
                          num(r['Kgs']) or None, num(r['Lts']) or None, txt(r['TipoTratamientoODF']), tipo,
                          fecha(r['FechaListCDF']), txt(r['CDFentregado']) == '1', fecha(r['CDFentFecha']),
                          Json(hab) if hab else None, self.archivo(r['Imagen']), entero(r['NroUsrAlta']),
                          # la historia ya se gestionó en el Access: no se vuelve a avisar a los clientes
                          datetime.combine(fecha(r['FechaCertificado']) or datetime(2010, 1, 1).date(), datetime.min.time()),
                          datetime.combine(fecha(r['CDFentFecha']) or fecha(r['FechaCertificado']) or datetime(2010, 1, 1).date(), datetime.min.time())))
        ids = self.insertar('certificados', ['numero', 'manifiesto_nacion_id', 'fecha', 'operador_id', 'generador_principal_id',
                                             'corriente_id', 'kgs', 'lts', 'tipo_tratamiento', 'tipo', 'fecha_listado', 'entregado',
                                             'entregado_fecha', 'habilitaciones', 'archivo', 'usuario_access', 'creado', 'enviado_cliente'],
                            filas, devolver='id, numero, manifiesto_nacion_id')
        self.cert = {(n, m): i for i, n, m in ids}
        conteo['certificados'] = (len(cds), len(ids))

        # --- manifiestos
        con_items = Counter(f"{r['IdManifiesto']}|{r['IdNroTransp']}" for r in det)
        filas = []
        for r in man:
            k = f"{r['IdManifiesto']}|{r['IdNroTransp']}"
            ta = int(r['IdNroTransp'])
            t = self.tr[ta]
            gpa = entero(r['IdGenerador'])
            if gpa and gpa not in self.gp: self.anotar('Manifiestos', k, 'migrado_sin_enlace', 'Generador principal inexistente', {'IdGenerador': gpa})
            if not gpa: self.anotar('Manifiestos', k, 'migrado_sin_enlace', 'Manifiesto sin generador principal')
            anul = es_anulado(r)
            if anul:
                self.anotar('Manifiestos', k, 'corregido', 'Marcado "ANULADO" en chofer o dirección: se migra como anulado')
                if con_items[k]: self.anotar('Manifiestos', k, 'revisar', 'Manifiesto anulado que tiene residuos cargados')
            elif not con_items[k]: self.anotar('Manifiestos', k, 'revisar', 'Manifiesto sin residuos cargados')
            pat = (txt(r['IdPatente']) or '').upper()
            cam = self.cam.get((t, pat)) if pat else None
            filas.append((txt(r['IdManifiesto']), t, 'azul' if self.tr_emite[ta] else 'rosa', fecha(r['FchaAltaManif']),
                          self.cli[int(r['IdClientes'])], self.gp.get(gpa), None if anul and 'ANULAD' in (txt(r['RetiroDirec']) or '').upper() else txt(r['RetiroDirec']),
                          None if anul else self.cho.get((t, nombre_chofer(r['IdChofer']))), cam, txt(r['NotaManif']), txt(r['FormaDeTransp']),
                          self.archivo(r['Ruta']), datetime.combine(fecha(r['FchUsrAlta']) or fecha(r['FchaAltaManif']), datetime.min.time()),
                          entero(r['NroUsrAlta']), anul, 'Anulado en el Access' if anul else None))
        ids = self.insertar('manifiestos', ['numero', 'transportista_id', 'tipo', 'fecha', 'generador_id', 'generador_principal_id',
                                            'direccion_retiro', 'chofer_id', 'camion_id', 'nota', 'forma_transporte', 'escaneo',
                                            'creado', 'usuario_access', 'anulado', 'anulado_motivo'], filas, devolver='id, numero, transportista_id')
        inv_tr = {v: k for k, v in self.tr.items()}
        self.man = {f'{n}|{inv_tr[t]}': i for i, n, t in ids}
        conteo['manifiestos'] = (len(man), len(ids))

        # --- residuos
        filas = []
        for r in det:
            k = r['IdDetManif']
            est = ESTADOS.get(txt(r['EstadoDetManif']))
            if not est:
                est = 'almacenado'
                self.anotar('ManifiestoDet', k, 'corregido', 'Estado desconocido: se toma como almacenado', {'estado': txt(r['EstadoDetManif'])})
            mk, ck = txt(r['IdManTraNac']), txt(r['NroCertDispFinal'])
            mtn_id = self.mtn.get(mk) if mk else None
            cert_id = self.cert.get((ck, mtn_id)) if ck else None
            ref = {}
            if mk and not mtn_id:
                ref['IdManTraNac'] = mk
                self.anotar('ManifiestoDet', k, 'migrado_sin_enlace', 'Manifiesto Nación inexistente', {'IdManTraNac': mk})
            if ck and not cert_id:
                ref['NroCertDispFinal'] = ck
                self.anotar('ManifiestoDet', k, 'migrado_sin_enlace', 'Certificado inexistente', {'NroCertDispFinal': ck, 'IdManTraNac': mk})
            if est == 'disposicion_final' and not ck:
                self.anotar('ManifiestoDet', k, 'revisar', 'En disposición final sin certificado')
            cant = num(r['Cantidad'])
            if not cant: self.anotar('ManifiestoDet', k, 'revisar', 'Cantidad en cero o vacía')
            u = um(r['IdMedida'])
            if not u:
                u = 'KGS'
                self.anotar('ManifiestoDet', k, 'corregido', 'Unidad desconocida: se toma kilos', {'IdMedida': txt(r['IdMedida'])})
            filas.append((int(k), self.man[f"{r['IdManifiesto']}|{r['IdNroTransp']}"], self.cor[txt(r['IdCorriente'])],
                          txt(r['DescripcionIngreso']), txt(r['DescripcionEgreso']), cant or 0, u, est, mtn_id, cert_id,
                          fecha(r['FchaEntDF']), entero(r['RPG']) or None, entero(r['NroCert']) or None, Json(ref) if ref else None))
        ids = self.insertar('manifiesto_items', ['id_access', 'manifiesto_id', 'corriente_id', 'contenedor', 'descripcion_egreso',
                                                 'cantidad', 'um', 'estado', 'manifiesto_nacion_id', 'certificado_id',
                                                 'fecha_entrega_df', 'rpg_nro', 'cert_rp_nro', 'ref_access'], filas, devolver='id')
        conteo['manifiesto_items'] = (len(det), len(ids))

        usados = {txt(r['IdManTraNac']) and self.cert.get((txt(r['NroCertDispFinal']), self.mtn.get(txt(r['IdManTraNac'])))) for r in det}
        for (n, m), i in self.cert.items():
            if i not in usados: self.anotar('CertificadosDispFinal', n, 'revisar', 'Certificado sin residuos asociados')

        # --- archivos a copiar al Storage
        self.insertar('migracion_archivos', ['ruta_access', 'carpeta', 'corrida_id'],
                      [(a, carpeta_raygroup(a), self.corrida) for a in sorted(self.archivos)])

        # --- usuarios: no se migran a auth (hace falta un mail por persona)
        for r in leer(self.mdb, 'Usuarios'):
            self.anotar('Usuarios', txt(r['Departamento']), 'revisar', 'Usuario del Access: crear en el sistema nuevo con su mail',
                        {'nivel': entero(r['Nivel']), 'usuario': txt(r['Usuario'])})

        # --- informe
        self.insertar('migracion_inconsistencias', ['corrida_id', 'tabla', 'clave_access', 'resultado', 'problema', 'detalle'],
                      [(self.corrida, *i) for i in self.incons])
        resumen = {t: {'access': a, 'nuevo': n} for t, (a, n) in conteo.items()}
        resumen['archivos'] = len(self.archivos)
        resumen['inconsistencias'] = len(self.incons)
        c.execute('update migracion_corridas set fin = now(), resumen = %s where id = %s', (Json(resumen), self.corrida))
        for tabla, nombre, defin in reglas:
            c.execute(f'alter table {tabla} add constraint {nombre} {defin.replace(" NOT VALID", "")} not valid')
        self.db.commit()
        return resumen


if __name__ == '__main__':
    if len(sys.argv) < 2 or not os.environ.get('DATABASE_URL'):
        sys.exit(__doc__)
    r = Migracion(sys.argv[1], os.environ['DATABASE_URL']).correr()
    print(json.dumps(r, indent=2, ensure_ascii=False))
