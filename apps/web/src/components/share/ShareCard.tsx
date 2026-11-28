import type { CSSProperties, ReactElement } from "react";
import type { ShareTile, TodayCardModel } from "@/lib/share/todayCard";

/**
 * The snapshot card as one JSX tree, shared by the `/share/today` page and
 * the PNG route (`next/og` ImageResponse → Satori). Satori only lays out
 * flexbox and inline styles, so this deliberately uses nothing else: every
 * element with more than one child is `display: flex`, no classes, no grid.
 *
 * Base size is 540 x 675 (4:5 portrait); `scale` multiplies every length so
 * the PNG renders at 1080 x 1350 from the same tree.
 */

export const CARD_BASE_WIDTH = 540;
export const CARD_BASE_HEIGHT = 675;

export type ShareCardProps = {
  model: TodayCardModel;
  scale?: number;
  /** Image mode: fixed height, square corners, Satori's bundled font. */
  forImage?: boolean;
};

export default function ShareCard({ model, scale = 1, forImage = false }: ShareCardProps): ReactElement {
  const p = model.palette;
  const px = (n: number) => n * scale;
  const [recovery, ...rest] = model.tiles;
  const rows = [rest.slice(0, 2), rest.slice(2, 4)];

  // Satori throws on a style key whose value is `undefined`, so the two
  // modes spread in their own keys rather than nulling the other's.
  const root: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    boxSizing: "border-box",
    padding: px(32),
    background: p.background,
    color: p.text,
    ...(forImage
      ? { width: px(CARD_BASE_WIDTH), height: px(CARD_BASE_HEIGHT) }
      : {
          width: "100%",
          maxWidth: px(CARD_BASE_WIDTH),
          minHeight: px(CARD_BASE_HEIGHT),
          borderRadius: px(24),
          border: `1px solid ${p.border}`,
          fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
        }),
  };

  return (
    <div style={root} data-theme-card={model.theme} role="figure" aria-label={`${model.dayLabel} snapshot, ${model.dateLabel}`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: px(13), letterSpacing: px(1.5), color: p.muted, textTransform: "uppercase" }}>
            {model.dayLabel}
          </div>
          <div style={{ display: "flex", fontSize: px(24), fontWeight: 700, marginTop: px(4) }}>{model.dateLabel}</div>
        </div>
        <div style={{ display: "flex", fontSize: px(14), color: p.muted, letterSpacing: px(1) }}>Coach</div>
      </div>

      <RecoveryHero tile={recovery} model={model} px={px} />

      <div style={{ display: "flex", flexDirection: "column", marginTop: px(20) }}>
        {rows.map((row, i) => (
          <div key={i} style={{ display: "flex", marginTop: i === 0 ? 0 : px(12) }}>
            {row.map((t, j) => (
              <Tile key={t.key} tile={t} model={model} px={px} gapLeft={j === 0 ? 0 : px(12)} />
            ))}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", flexGrow: 1 }} />

      <div style={{ display: "flex", fontSize: px(17), lineHeight: 1.4, marginTop: px(20) }} data-share-recap="">
        {model.recap}
      </div>
      <div style={{ display: "flex", fontSize: px(12), color: p.muted, marginTop: px(12) }}>
        {model.hideNumbers ? "Numbers hidden - bands only" : "Whoop data, summarised by Coach"}
      </div>
    </div>
  );
}

type Px = (n: number) => number;

function RecoveryHero({ tile, model, px }: { tile: ShareTile; model: TodayCardModel; px: Px }) {
  const p = model.palette;
  const color = p.tones[tile.tone];
  const ring = px(132);
  // In hide-numbers mode the ring shows the band word in place of the score.
  const center = tile.value ?? (tile.missing ? "--" : (tile.band ?? "--"));
  return (
    <div style={{ display: "flex", alignItems: "center", marginTop: px(28) }} data-share-tile="recovery">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: ring,
          height: ring,
          borderRadius: ring,
          border: `${px(10)}px solid ${tile.missing ? p.border : color}`,
          boxSizing: "border-box",
          fontSize: tile.value ? px(38) : px(22),
          fontWeight: 700,
          color: tile.missing ? p.muted : p.text,
        }}
      >
        {center}
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginLeft: px(24) }}>
        <div style={{ display: "flex", fontSize: px(14), color: p.muted }}>{tile.label}</div>
        {/* Hide mode already shows the band inside the ring; don't repeat it. */}
        {tile.value !== null || tile.missing ? (
          <div style={{ display: "flex", fontSize: px(22), fontWeight: 700, marginTop: px(4), color: tile.missing ? p.muted : color }}>
            {tile.band ?? ""}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Tile({ tile, model, px, gapLeft }: { tile: ShareTile; model: TodayCardModel; px: Px; gapLeft: number }) {
  const p = model.palette;
  const color = p.tones[tile.tone];
  // The big line is the number, or (hide mode / missing) the band.
  const headline = tile.value ?? tile.band ?? "--";
  const showBandTag = tile.value !== null && tile.band !== null;
  return (
    <div
      data-share-tile={tile.key}
      style={{
        display: "flex",
        flexDirection: "column",
        flexBasis: 0,
        flexGrow: 1,
        marginLeft: gapLeft,
        padding: px(16),
        borderRadius: px(16),
        background: p.surface,
        border: `1px solid ${p.border}`,
        minHeight: px(104),
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", fontSize: px(13), color: p.muted }}>{tile.label}</div>
      <div
        style={{
          display: "flex",
          fontSize: tile.value ? px(26) : px(20),
          fontWeight: 700,
          marginTop: px(6),
          color: tile.missing ? p.muted : tile.value ? p.text : color,
        }}
      >
        {headline}
      </div>
      {showBandTag ? (
        <div style={{ display: "flex", alignItems: "center", marginTop: px(6), fontSize: px(13), color }}>
          <div style={{ display: "flex", width: px(8), height: px(8), borderRadius: px(8), background: color, marginRight: px(6) }} />
          {tile.band}
        </div>
      ) : null}
      {tile.detail ? (
        <div style={{ display: "flex", marginTop: px(4), fontSize: px(12), color: p.muted }}>{tile.detail}</div>
      ) : null}
    </div>
  );
}
