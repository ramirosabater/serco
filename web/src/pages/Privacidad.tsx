// Política de privacidad: página pública (la pide Google para el permiso del Drive y sirve para la AAIP)
export default function Privacidad() {
  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '28px 18px 48px' }}>
      <p><img src="/serco-logo.png" alt="Serco Ambiental" style={{ height: 44 }} /></p>
      <h1>Política de privacidad</h1>
      <p className="sub">Gestión Serco · Serco Ambiental S.A. · CUIT 30-71024760-5 · Carlos Kirn Nº 325, Comodoro Rivadavia, Chubut</p>

      <h2>Qué es este sistema</h2>
      <p>Gestión Serco es el sistema interno de Serco Ambiental S.A. para registrar el transporte, almacenamiento y disposición final de
        residuos peligrosos: manifiestos, viajes, certificados y habilitaciones de generadores, transportistas, camiones y choferes.</p>

      <h2>Qué datos se guardan</h2>
      <ul>
        <li>De empresas generadoras, transportistas y operadores: razón social, CUIT, domicilio, contacto y habilitaciones.</li>
        <li>De choferes: nombre, DNI, mail de contacto y sus certificados y licencias (con su vencimiento).</li>
        <li>De los usuarios del sistema: nombre, mail y lo que hace cada uno (queda registrado quién cargó o cambió cada dato).</li>
        <li>Los documentos escaneados: manifiestos, certificados de disposición final y habilitaciones.</li>
      </ul>

      <h2>Para qué se usan</h2>
      <p>Solo para cumplir con la normativa de residuos peligrosos (Ley 24.051 y normas de la Provincia del Chubut), llevar los libros
        que exigen los organismos de control, avisar vencimientos y entregar a cada cliente sus certificados. No se venden ni se ceden a terceros,
        salvo a los organismos de control cuando la ley lo pide.</p>

      <h2>Dónde se guardan</h2>
      <p>Los datos están en una base de datos con acceso restringido (Supabase). Los documentos escaneados se guardan en el Google Drive
        de Serco Ambiental (ambientalserco@gmail.com). El sistema solo accede a los archivos que él mismo sube a ese Drive; no ve ni toca
        ningún otro archivo de la cuenta. Ningún documento tiene enlace público: para verlo hace falta un usuario del sistema y el enlace
        que se genera vence a los pocos minutos.</p>

      <h2>Quién puede verlos</h2>
      <p>El personal autorizado de Serco Ambiental. Cada cliente ve solo sus propios retiros y certificados.</p>

      <h2>Tus derechos</h2>
      <p>Podés pedir ver, corregir o borrar tus datos personales escribiendo a <a href="mailto:ambientalserco@gmail.com">ambientalserco@gmail.com</a>,
        según la Ley 25.326 de Protección de Datos Personales. La Agencia de Acceso a la Información Pública, órgano de control de esa ley,
        atiende las denuncias y reclamos de quienes vean afectados sus derechos.</p>

      <p className="muted small">Última actualización: noviembre de 2026.</p>
    </main>
  )
}
