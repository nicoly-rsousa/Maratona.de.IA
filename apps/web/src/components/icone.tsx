import type { SvgIconComponent } from "@mui/icons-material";

/**
 * Ícone Material padronizado (tamanho relativo à fonte, alinhado ao texto).
 * Decorativo por padrão (aria-hidden): o texto ao lado dá o nome. Com `rotulo`, vira imagem com nome acessível.
 */
export function Icone({ de: Svg, rotulo, grande }: { de: SvgIconComponent; rotulo?: string; grande?: boolean }) {
  return <Svg className={grande ? "icon icon--lg" : "icon"} fontSize="inherit" titleAccess={rotulo} focusable="false" />;
}
