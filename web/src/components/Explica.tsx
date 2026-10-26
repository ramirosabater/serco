import type { Paso } from '../lib/guias'

// "¿Qué es esto?": un botoncito junto a un número o un gráfico. Serquito lo explica con los datos que se ven
// en ese momento, resaltando lo que se explica. Solo explica y, si hace falta, ofrece ir a ver el detalle.

export function explicar(titulo: string, pasos: Paso[], seguido = false) {
  window.AyudaApp?.explicar(titulo, pasos, seguido)
}

/** Botón "?" que explica una cosa. `paso` se arma en el momento del clic, con los números actuales. */
export default function Explica({ titulo, paso, etiqueta }: { titulo: string; paso: () => Paso | null; etiqueta?: string }) {
  return (
    <button type="button" className="explica no-imprimir" aria-label={etiqueta ?? `Qué significa: ${titulo}`} title="¿Qué significa?"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); const p = paso(); if (p) explicar(titulo, [p]) }}>?</button>
  )
}

/** "Explicame esta pantalla": recorre todo lo que tiene "?" en orden, con voz si está activada */
export function ExplicarTodo({ titulo, pasos, texto = 'Explicame esta pantalla' }: { titulo: string; pasos: () => Paso[]; texto?: string }) {
  return (
    <button type="button" className="link no-imprimir explica-todo" data-ayuda="explicar-todo" onClick={() => explicar(titulo, pasos(), true)}>
      <span className="explica" aria-hidden="true">?</span> {texto}
    </button>
  )
}
