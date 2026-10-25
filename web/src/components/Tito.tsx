import { forwardRef } from 'react'
import type { Area } from '../lib/guias'

// Tito: el ayudante de Gestión Serco. Una batea de residuos con cara, gorra y bigote, que cambia de "traje"
// según el área: casco y chaleco en planta, anteojos y carpeta en manifiestos, calculadora en
// reportes, lupa en altas, llave en configuración y auricular en el portal del cliente.
// angulo: hacia dónde señala, en grados (0 = derecha, -90 = arriba, 90 = abajo, ±180 = izquierda).

interface Props { traje?: Area; angulo?: number | null; hablando?: boolean; festejo?: boolean; saluda?: boolean; tamano?: number }

const VERDE = '#2E9E4F', VERDE_OSC = '#1D7A3A', VERDE_CLARO = '#EAF6EC', TINTA = '#16301E'

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

const Tito = forwardRef<SVGSVGElement, Props>(function Tito(
  { traje = 'tablero', angulo = null, hablando = false, festejo = false, saluda = false, tamano = 96 }, ref) {
  const derecha = angulo == null || Math.abs(angulo) <= 90
  // Brazos dibujados hacia abajo; se rotan desde el hombro para señalar
  const rotDer = angulo != null && derecha ? angulo - 90 : saluda ? -150 : 20
  const rotIzq = angulo != null && !derecha ? angulo - 90 : -20
  return (
    <svg ref={ref} className={`tito${hablando ? ' habla' : ''}${festejo ? ' festeja' : ''}${saluda ? ' saluda' : ''}`}
      width={tamano} height={tamano} viewBox="-12 0 144 124" role="img" aria-label="Tito, el ayudante">
      <ellipse cx="60" cy="118" rx="34" ry="4.5" className="bt-sombra" />
      <g className="bt-cuerpo">
        {/* ruedas */}
        <circle cx="34" cy="110" r="6.5" fill="#39424C" /><circle cx="34" cy="110" r="2.4" fill="#A8B0B9" />
        <circle cx="86" cy="110" r="6.5" fill="#39424C" /><circle cx="86" cy="110" r="2.4" fill="#A8B0B9" />
        {/* residuos que asoman */}
        <ellipse cx="38" cy="38" rx="13" ry="10" fill="#4A535C" />
        <path d="M35 29 q3 -6 6 0" stroke="#4A535C" strokeWidth="3" fill="none" />
        <rect x="64" y="25" width="15" height="18" rx="3" fill="#2F6FB0" /><rect x="64" y="30" width="15" height="2.4" fill="#255A8F" />
        <path d="M84 40 q4 -14 12 -12 q-2 10 -12 12z" fill="#7CC97F" />
        {/* batea */}
        <path d="M16 46 L104 46 L95 104 L25 104 Z" fill={VERDE} />
        <path d="M16 46 L104 46 L102 58 L18 58 Z" fill="#000" opacity="0.08" />
        <rect x="10" y="40" width="100" height="9" rx="3.5" fill={VERDE_OSC} />
        <path d="M22 60 L28 100 M98 60 L92 100" stroke={VERDE_OSC} strokeWidth="3" opacity="0.6" />
        {/* chaleco (planta) */}
        {traje === 'planta' && <g>
          <path d="M23 82 L97 82 L95 98 L25 98 Z" fill="#FF8A1F" />
          <path d="M24 88 L96 88" stroke="#E8EEF2" strokeWidth="3" />
          <path d="M24 93 L96 93" stroke="#E8EEF2" strokeWidth="1.6" opacity="0.8" />
        </g>}
        {/* cara */}
        <rect x="32" y="54" width="56" height="38" rx="12" fill={VERDE_CLARO} />
        <g className="bt-ojos">
          <ellipse cx="49" cy="68" rx="4.4" ry="5.6" fill={TINTA} />
          <ellipse cx="71" cy="68" rx="4.4" ry="5.6" fill={TINTA} />
          <circle cx="50.5" cy="66" r="1.5" fill="#fff" /><circle cx="72.5" cy="66" r="1.5" fill="#fff" />
        </g>
        <path d="M42 59 q7 -5 14 -1 M64 58 q7 -4 14 1" stroke={TINTA} strokeWidth="3.4" fill="none" strokeLinecap="round" />
        {(traje === 'manifiestos' || traje === 'reportes') && <g fill="none" stroke="#3B3F45" strokeWidth="2">
          <circle cx="49" cy="68" r="8" /><circle cx="71" cy="68" r="8" /><path d="M57 67 q3 -3 6 0" />
        </g>}
        <circle cx="41" cy="79" r="4" fill="#E8907A" opacity="0.25" /><circle cx="79" cy="79" r="4" fill="#E8907A" opacity="0.25" />
        <path className="bt-sonrisa" d="M52 80 Q60 88 68 80" stroke={TINTA} strokeWidth="2.8" fill="none" strokeLinecap="round" />
        <ellipse className="bt-boca" cx="60" cy="83" rx="5.5" ry="4" fill="#7A2635" />
        <path className="bt-bigote" d="M60 77 C55 73 47 74 45 79 C50 78 55 80 60 79 C65 80 70 78 75 79 C73 74 65 73 60 77 Z" fill="#4A3324" />
        {/* brazo izquierdo (con lo que lleva en la mano) */}
        <g className="bt-brazo" style={{ transform: `rotate(${rotIzq}deg)`, transformOrigin: '22px 62px' }}>
          <g transform="translate(22 62)">
            <path d="M0 0 L0 30" stroke={VERDE_OSC} strokeWidth="7" strokeLinecap="round" />
            <circle cx="0" cy="33" r="5.5" fill={VERDE} />
            <g transform="translate(6 -17)"><Objeto traje={traje} /></g>
          </g>
        </g>
        {/* brazo derecho: el que saluda y señala */}
        <g className="bt-brazo bt-derecho" style={{ transform: `rotate(${rotDer}deg)`, transformOrigin: '98px 62px' }}>
          <path d="M98 62 L98 92" stroke={VERDE_OSC} strokeWidth="7" strokeLinecap="round" />
          <circle cx="98" cy="95" r="5.5" fill={VERDE} />
          <path d="M98 99 L98 104" stroke={VERDE} strokeWidth="3.4" strokeLinecap="round" />
        </g>
        {/* gorra (todos los trajes menos planta y cliente) */}
        {traje !== 'planta' && traje !== 'cliente' && <g>
          <path d="M37 33 C37 13 83 13 83 33 Z" fill="#0B6E22" />
          <path d="M80 30 C92 30 100 34 101 38 L79 36 Z" fill="#095A1C" />
          <rect x="35" y="30" width="48" height="5" rx="2.5" fill="#095A1C" />
          <circle cx="60" cy="22" r="5" fill="#fff" /><text x="60" y="25" textAnchor="middle" fontSize="8" fontWeight="900" fill="#0B6E22" fontFamily="Arial">S</text>
        </g>}
        {/* casco (planta) */}
        {traje === 'planta' && <g>
          <path d="M34 30 C34 8 86 8 86 30 Z" fill="#FFC928" />
          <rect x="28" y="28" width="64" height="6" rx="3" fill="#F2B600" />
          <rect x="56" y="10" width="8" height="18" rx="3" fill="#F2B600" />
        </g>}
        {/* auricular (portal del cliente) */}
        {traje === 'cliente' && <g fill="none" stroke="#3B4552" strokeWidth="3.4" strokeLinecap="round">
          <path d="M30 46 C30 14 90 14 90 46" />
          <rect x="24" y="42" width="9" height="13" rx="3" fill="#3B4552" stroke="none" />
          <rect x="87" y="42" width="9" height="13" rx="3" fill="#3B4552" stroke="none" />
          <path d="M28 54 C28 66 34 72 42 74" strokeWidth="2.2" /><circle cx="43" cy="74" r="2.6" fill="#3B4552" stroke="none" />
        </g>}
      </g>
    </svg>
  )
})

export default Tito
