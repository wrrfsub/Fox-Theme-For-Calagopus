import type { NebulaTheme } from '../../lib/theme.ts';

/** A theme's page, surface, accent and highlight as dots; the colours are normalized hex values. */
export default function Swatches({ theme }: { theme: Partial<NebulaTheme> }) {
  return (
    <span className='flex shrink-0 gap-1'>
      {[theme.background, theme.surface, theme.accent, theme.highlight].map((swatch, i) =>
        swatch ? (
          <span
            key={i}
            className='size-5 rounded-full border border-(--mantine-color-default-border)'
            style={{ background: swatch }}
          />
        ) : null,
      )}
    </span>
  );
}
