import PccsPalette, { type InitialColor } from "@/components/PccsPalette";

// Render per request so every visit starts from a different colour.
export const dynamic = "force-dynamic";

const round2 = (x: number) => Math.round(x * 100) / 100;

/** A random starting colour (avoiding near-black and near-grey picks). */
function randomColor(): InitialColor {
  return {
    hue: Math.floor(Math.random() * 360),
    sat: round2(0.25 + Math.random() * 0.75),
    val: round2(0.35 + Math.random() * 0.65),
  };
}

export default function Page() {
  return <PccsPalette initial={randomColor()} />;
}
