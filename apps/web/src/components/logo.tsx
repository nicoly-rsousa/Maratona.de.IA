import Image from "next/image";

/** Símbolo do Farol. Decorativo: o nome "Farol" vem ao lado. */
export function IconeFarol({ tamanho = 26 }: { tamanho?: number }) {
  return (
    <Image
      src="/farol-logo.png"
      alt=""
      width={tamanho}
      height={tamanho}
      aria-hidden="true"
      style={{ width: tamanho, height: tamanho }}
      className="shrink-0 object-contain"
      priority
    />
  );
}
