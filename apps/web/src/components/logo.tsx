/** Símbolo do Farol: torre com feixes de luz, na cor de destaque do tema (--ac). Decorativo: o nome "Farol" vem ao lado. */
export function IconeFarol({ tamanho = 18 }: { tamanho?: number }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" stroke="var(--ac)" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {/* feixes */}
      <path d="M8.5 5.5 3 3.5M8.5 7.5 3 9.5M15.5 5.5 21 3.5M15.5 7.5 21 9.5" />
      {/* lanterna e cúpula */}
      <path d="M10 4h4v5h-4zM9.5 4 12 2l2.5 2" />
      {/* torre */}
      <path d="M10 9 8.5 20h7L14 9M9.2 14.5h5.6" />
      {/* base */}
      <path d="M6 20h12" />
    </svg>
  );
}
