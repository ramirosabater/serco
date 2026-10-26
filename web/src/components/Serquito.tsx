import { forwardRef } from 'react'
import type { Area } from '../lib/guias'

// Serquito: el ayudante de Gestión Serco. Un camioncito volcador con su batea cargada, ojos grandes en el frente
// y una sonrisa en la parrilla. Cambia de "traje" según el área: casco y franjas reflectivas en planta,
// anteojos y carpeta en manifiestos, calculadora en reportes, lupa en altas, llave en configuración
// y auricular en el portal del cliente. Colores propios (naranja y azul), distintos de los de la empresa.
// angulo: hacia dónde señala, en grados (0 = derecha, -90 = arriba, 90 = abajo, ±180 = izquierda).

interface Props { traje?: Area; angulo?: number | null; hablando?: boolean; festejo?: boolean; saluda?: boolean; tamano?: number }

const NARANJA = '#FF7A1A', NARANJA_OSC = '#D2560A', AZUL = '#2F4F9E', AZUL_OSC = '#213A78', TINTA = '#1E2533', GOMA = '#2B3038', LLANTA = '#C9D1DA'

function Objeto({ traje }: { traje: Area }) {
  // Lo que lleva en la mano izquierda (se mueve con el brazo)
  switch (traje) {
    case 'manifiestos': return (
      <g transform="translate(-6 50)">
        <rect x="-9" y="-2" width="16" height="21" rx="2" fill="#C98B4B" />
        <rect x="-7" y="1" width="12" height="16" rx="1" fill="#fff" />
        <rect x="-4" y="-4" width="6" height="4" rx="1" fill="#8A8F98" />
        <path d="M-5 6 h8 M-5 10 h8 M-5 14 h5" stroke="#9AA3AD" strokeWidth="1.2" />
      </g>)
    case 'reportes': return (
      <g transform="translate(-6 50)">
        <rect x="-8" y="-1" width="15" height="20" rx="2.5" fill="#3B4552" />
        <rect x="-6" y="1.5" width="11" height="5" rx="1" fill="#BFF0C9" />
        {[0, 1, 2].map((f) => [0, 1, 2].map((c) => <rect key={`${f}${c}`} x={-6 + c * 4} y={8.5 + f * 3.3} width="3" height="2.4" rx="0.6" fill="#E9ECEF" />))}
      </g>)
    case 'altas': return (
      <g transform="translate(-6 52)">
        <circle cx="-2" cy="2" r="7" fill="#DCEFFF" fillOpacity="0.7" stroke="#5A6470" strokeWidth="2.4" />
        <path d="M3 7 L9 14" stroke="#7A4A22" strokeWidth="3.4" strokeLinecap="round" />
      </g>)
    case 'configuracion': return (
      <g transform="translate(-6 50) rotate(-30)">
        <path d="M-2 -6 a6 6 0 1 0 4 0 v5 h-4z" fill="#8A95A3" />
        <rect x="-2" y="3" width="4" height="16" rx="2" fill="#8A95A3" />
      </g>)
    default: return null
  }
}

function Rueda({ x }: { x: number }) {
  return (
    <g>
      <circle cx={x} cy="106" r="11" fill={GOMA} />
      <circle cx={x} cy="106" r="5.2" fill={LLANTA} />
      <circle cx={x} cy="106" r="1.8" fill={GOMA} />
    </g>
  )
}

const Serquito = forwardRef<SVGSVGElement, Props>(function Serquito(
  { traje = 'tablero', angulo = null, hablando = false, festejo = false, saluda = false, tamano = 96 }, ref) {
  const derecha = angulo == null || Math.abs(angulo) <= 90
  // Brazos dibujados hacia abajo; se rotan desde el hombro para señalar
  const rotDer = angulo != null && derecha ? angulo - 90 : saluda ? -150 : 20
  const rotIzq = angulo != null && !derecha ? angulo - 90 : -20
  return (
    <svg ref={ref} className={`tito${hablando ? ' habla' : ''}${festejo ? ' festeja' : ''}${saluda ? ' saluda' : ''}`}
      width={tamano} height={tamano} viewBox="-12 0 144 124" role="img" aria-label="Serquito, el ayudante">
      <ellipse cx="66" cy="118" rx="52" ry="4.5" className="bt-sombra" />
      <g className="bt-cuerpo">
        {/* ---- la batea, atrás de la cabina, un poco levantada */}
        <g transform="rotate(-6 112 92)">
          {/* lo que lleva */}
          <ellipse cx="80" cy="38" rx="11" ry="8" fill="#5B6470" />
          <rect x="92" y="26" width="13" height="16" rx="3" fill="#E5B73B" /><rect x="92" y="31" width="13" height="2.4" fill="#C49A26" />
          <path d="M104 40 q5 -14 13 -11 q-3 10 -13 11z" fill="#79C27C" />
          <path d="M60 40 L120 40 L115 90 L64 90 Z" fill={AZUL} />
          <rect x="56" y="34" width="68" height="8" rx="3.5" fill={AZUL_OSC} />
          <path d="M74 44 L76 88 M90 44 L90 88 M106 44 L104 88" stroke={AZUL_OSC} strokeWidth="2.6" opacity="0.7" />
          <path d="M60 40 L120 40 L119 50 L61 50 Z" fill="#000" opacity="0.1" />
        </g>
        {/* chasis y ruedas */}
        <rect x="22" y="90" width="98" height="9" rx="3" fill="#3A414B" />
        <Rueda x={104} /><Rueda x={30} /><Rueda x={74} />
        {/* ---- la cabina, de frente */}
        <rect x="18" y="32" width="68" height="64" rx="13" fill={NARANJA} />
        <rect x="18" y="32" width="68" height="10" rx="5" fill="#fff" opacity="0.18" />
        {/* parabrisas (sin cara: la cara va en el frente) */}
        <rect x="25" y="38" width="54" height="14" rx="5" fill="#BFE3F5" />
        <path d="M33 40 l-5 10 M44 40 l-5 10" stroke="#fff" strokeWidth="2.4" opacity="0.7" strokeLinecap="round" />
        {/* ojos */}
        <g className="bt-ojos">
          <ellipse cx="40" cy="68" rx="9" ry="10" fill="#fff" />
          <ellipse cx="64" cy="68" rx="9" ry="10" fill="#fff" />
          <circle cx="42" cy="69" r="4.8" fill={TINTA} /><circle cx="62" cy="69" r="4.8" fill={TINTA} />
          <circle cx="43.6" cy="66.8" r="1.7" fill="#fff" /><circle cx="63.6" cy="66.8" r="1.7" fill="#fff" />
        </g>
        <path d="M31 56 q8 -4 16 0 M57 56 q8 -4 16 0" stroke={NARANJA_OSC} strokeWidth="3.4" fill="none" strokeLinecap="round" />
        {(traje === 'manifiestos' || traje === 'reportes') && <g fill="none" stroke="#2E333B" strokeWidth="2.2">
          <circle cx="40" cy="68" r="12" /><circle cx="64" cy="68" r="12" /><path d="M50 66 q2 -3 4 0" />
        </g>}
        {/* faros (cachetes) */}
        <circle cx="25" cy="83" r="4" fill="#FFE27A" stroke={NARANJA_OSC} strokeWidth="1.4" />
        <circle cx="79" cy="83" r="4" fill="#FFE27A" stroke={NARANJA_OSC} strokeWidth="1.4" />
        {/* parrilla-sonrisa */}
        <path className="bt-sonrisa" d="M40 81 Q52 92 64 81" stroke={TINTA} strokeWidth="3" fill="none" strokeLinecap="round" />
        <ellipse className="bt-boca" cx="52" cy="85" rx="7" ry="4.6" fill="#7A2635" />
        {/* paragolpes con el nombre */}
        <rect x="15" y="91" width="74" height="8" rx="3.5" fill="#AEB7C2" />
        {traje === 'planta'
          ? <g>{[0, 1, 2, 3, 4, 5, 6].map((k) => <path key={k} d={`M${19 + k * 10} 99 l5 -8 h5 l-5 8z`} fill="#FFC928" />)}</g>
          : <text x="52" y="97.4" textAnchor="middle" fontSize="6" fontWeight="900" letterSpacing="0.6" fill="#3A414B" fontFamily="Arial, sans-serif">SERQUITO</text>}
        {/* brazo izquierdo (con lo que lleva en la mano) */}
        <g className="bt-brazo" style={{ transform: `rotate(${rotIzq}deg)`, transformOrigin: '18px 64px' }}>
          <g transform="translate(18 64)">
            <path d="M0 0 L0 28" stroke={NARANJA_OSC} strokeWidth="6.5" strokeLinecap="round" />
            <circle cx="0" cy="31" r="5.5" fill="#fff" stroke="#D5DBE2" strokeWidth="1.2" />
            <g transform="translate(6 -17)"><Objeto traje={traje} /></g>
          </g>
        </g>
        {/* brazo derecho: el que saluda y señala */}
        <g className="bt-brazo bt-derecho" style={{ transform: `rotate(${rotDer}deg)`, transformOrigin: '86px 64px' }}>
          <path d="M86 64 L86 92" stroke={NARANJA_OSC} strokeWidth="6.5" strokeLinecap="round" />
          <circle cx="86" cy="95" r="5.5" fill="#fff" stroke="#D5DBE2" strokeWidth="1.2" />
          <path d="M86 99 L86 104" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" />
        </g>
        {/* gorra (todos los trajes menos planta y cliente) */}
        {traje !== 'planta' && traje !== 'cliente' && <g>
          <path d="M30 33 C30 13 74 13 74 33 Z" fill={AZUL} />
          <path d="M71 30 C83 30 91 34 92 38 L70 36 Z" fill={AZUL_OSC} />
          <rect x="28" y="30" width="48" height="5" rx="2.5" fill={AZUL_OSC} />
          <circle cx="52" cy="22" r="5" fill="#fff" /><text x="52" y="25" textAnchor="middle" fontSize="8" fontWeight="900" fill={AZUL} fontFamily="Arial">S</text>
        </g>}
        {/* casco (planta) */}
        {traje === 'planta' && <g>
          <path d="M27 30 C27 8 77 8 77 30 Z" fill="#FFC928" />
          <rect x="21" y="28" width="62" height="6" rx="3" fill="#F2B600" />
          <rect x="48" y="10" width="8" height="18" rx="3" fill="#F2B600" />
        </g>}
        {/* auricular (portal del cliente) */}
        {traje === 'cliente' && <g fill="none" stroke="#3B4552" strokeWidth="3.4" strokeLinecap="round">
          <path d="M20 44 C20 12 84 12 84 44" />
          <rect x="13" y="40" width="9" height="13" rx="3" fill="#3B4552" stroke="none" />
          <rect x="82" y="40" width="9" height="13" rx="3" fill="#3B4552" stroke="none" />
          <path d="M17 52 C17 64 22 72 28 76" strokeWidth="2.2" /><circle cx="29" cy="76" r="2.6" fill="#3B4552" stroke="none" />
        </g>}
      </g>
    </svg>
  )
})

export default Serquito
