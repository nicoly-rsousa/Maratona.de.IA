// postcss-import primeiro: globals.css monta as camadas de estilo com @import (abordagem oficial do Tailwind 3).
export default {
  plugins: { "postcss-import": {}, tailwindcss: {}, autoprefixer: {} },
};
