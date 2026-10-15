import { forwardRef } from 'react'

// "Brote": el personaje de la ayuda. Un brote con casco de seguridad que señala lo que explica.
// angulo: hacia dónde señala, en grados (0 = derecha, -90 = arriba, 90 = abajo, ±180 = izquierda).

interface Props { angulo?: number | null; hablando?: boolean; festejo?: boolean; tamano?: number }

const Avatar = forwardRef<SVGSVGElement, Props>(function Avatar({ angulo = null, hablando = false, festejo = false, tamano = 84 }, ref) {
  // Señala con la mano derecha si el objetivo está a la derecha; si no, con la izquierda
  const derecha = angulo == null || Math.abs(angulo) <= 90
  const rotDer = angulo != null && derecha ? angulo : 35          // brazo en reposo, hacia abajo
  const rotIzq = angulo != null && !derecha ? angulo - 180 : -35   // el brazo izquierdo está dibujado hacia la izquierda
  return (
    <svg ref={ref} className={`avatar${hablando ? ' habla' : ''}${festejo ? ' festeja' : ''}`} width={tamano} height={tamano * 1.1}
      viewBox="0 0 100 110" role="img" aria-label="Brote, el guía de la ayuda">
      <ellipse cx="50" cy="105" rx="22" ry="4" className="av-sombra" />
      <g className="av-cuerpo">
        {/* pies */}
        <ellipse cx="40" cy="98" rx="8" ry="4.5" fill="#1F7A35" />
        <ellipse cx="60" cy="98" rx="8" ry="4.5" fill="#1F7A35" />
        {/* brazos */}
        <g className="av-brazo" style={{ transform: `rotate(${rotIzq}deg)`, transformOrigin: '20px 66px' }}>
          <path d="M20 66 L4 66" stroke="#239A43" strokeWidth="6" strokeLinecap="round" />
          <circle cx="3" cy="66" r="4.5" fill="#2BB04E" />
        </g>
        <g className="av-brazo" style={{ transform: `rotate(${rotDer}deg)`, transformOrigin: '80px 66px' }}>
          <path d="M80 66 L96 66" stroke="#239A43" strokeWidth="6" strokeLinecap="round" />
          <circle cx="97" cy="66" r="4.5" fill="#2BB04E" />
        </g>
        {/* cuerpo */}
        <path d="M50 24 C74 24 82 46 82 64 C82 86 68 97 50 97 C32 97 18 86 18 64 C18 46 26 24 50 24Z" fill="#2BB04E" />
        <ellipse cx="50" cy="76" rx="20" ry="16" fill="#5CCB72" opacity="0.55" />
        {/* cara */}
        <g className="av-ojos">
          <ellipse cx="41" cy="58" rx="4.2" ry="5.2" fill="#14301C" />
          <ellipse cx="59" cy="58" rx="4.2" ry="5.2" fill="#14301C" />
          <circle cx="42.4" cy="56.2" r="1.4" fill="#fff" />
          <circle cx="60.4" cy="56.2" r="1.4" fill="#fff" />
        </g>
        <circle cx="34" cy="67" r="3.6" fill="#FF8FA3" opacity="0.45" />
        <circle cx="66" cy="67" r="3.6" fill="#FF8FA3" opacity="0.45" />
        <path className="av-sonrisa" d="M43 69 Q50 76 57 69" stroke="#14301C" strokeWidth="2.6" fill="none" strokeLinecap="round" />
        <ellipse className="av-boca" cx="50" cy="71" rx="5" ry="3.6" fill="#14301C" />
        {/* casco */}
        <path d="M26 40 C26 17 74 17 74 40 Z" fill="#FAFBF7" stroke="#D5DDD2" strokeWidth="1.2" />
        <rect x="46" y="20" width="8" height="20" rx="3" fill="#0B8A22" />
        <rect x="19" y="37" width="62" height="7" rx="3.5" fill="#FFFFFF" stroke="#D5DDD2" strokeWidth="1.2" />
        {/* brote */}
        <path d="M50 20 C50 14 50 11 50 8" stroke="#1F7A35" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M50 10 C44 4 37 5 35 9 C40 12 46 12 50 10Z" fill="#5CCB72" />
        <path d="M50 9 C55 2 63 2 66 6 C61 10 55 11 50 9Z" fill="#2BB04E" />
      </g>
    </svg>
  )
})

export default Avatar
