# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "pccs==0.2a3",
#     "colour-science==0.4.7",
#     "sympy",
#     "scipy",
# ]
# ///
"""
Export every PCCS pattern (hue x lightness x saturation, plus neutrals)
to JSON using the `pccs` Python library.

    uv run scripts/export_pccs.py [full.json] [compact-lab.json]

Pipeline for each pattern:

    PCCS (h, l, s)
      -- pccs library (Kobayashi & Yoshiki 2001) -->  Munsell HVC
      -- colour-science (Munsell Renotation data) --> xyY (Illuminant C)
      -- Bradford CAT C -> D65 -->                     sRGB

Munsell Renotation and the Kobayashi & Yoshiki relation are both built on
visual (perceptual) evaluations, so the resulting sRGB values reflect PCCS
as a perceptual system rather than an RGB-derived formula.
"""

from __future__ import annotations

import json
import sys
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")

# --- Compatibility shim ----------------------------------------------------
# pccs 0.2a3 imports names from an older colour-science API. colour-science
# 0.3.x (which had those names) does not run on Apple Silicon (np.float128),
# so we alias the renamed symbols of the current release before importing.
import colour.constants as _cc  # noqa: E402
import colour.notation.munsell as _cm  # noqa: E402

if not hasattr(_cc, "FLOATING_POINT_NUMBER_PATTERN"):
    _cc.FLOATING_POINT_NUMBER_PATTERN = _cc.PATTERN_FLOATING_POINT_NUMBER
if not hasattr(_cm, "normalize_munsell_specification"):
    _cm.normalize_munsell_specification = _cm.normalise_munsell_specification
# ---------------------------------------------------------------------------

import colour  # noqa: E402
import numpy as np  # noqa: E402
import pccs  # noqa: E402

HUES = list(range(1, 25))  # 1:pR .. 24:RP
LIGHTNESSES = [x / 2 for x in range(3, 20)]  # 1.5 .. 9.5 (0.5 step)
SATURATIONS = list(range(1, 10))  # 1s .. 9s

ILLUMINANT_C = colour.CCS_ILLUMINANTS["CIE 1931 2 Degree Standard Observer"]["C"]
ILLUMINANT_D65 = colour.CCS_ILLUMINANTS["CIE 1931 2 Degree Standard Observer"]["D65"]
SRGB = colour.RGB_COLOURSPACES["sRGB"]


def munsell_to_colour(spec: np.ndarray) -> dict | None:
    """Munsell specification -> xyY / XYZ / sRGB. None if outside renotation."""
    try:
        xyY = colour.notation.munsell.munsell_specification_to_xyY(spec)
    except (ValueError, AssertionError):  # outside Munsell Renotation domain
        return None
    XYZ = colour.xyY_to_XYZ(xyY)
    rgb = colour.XYZ_to_RGB(
        XYZ,
        SRGB,
        illuminant=ILLUMINANT_C,
        chromatic_adaptation_transform="Bradford",
        apply_cctf_encoding=True,
    )
    XYZ_d65 = colour.adaptation.chromatic_adaptation_VonKries(
        XYZ, colour.xy_to_XYZ(ILLUMINANT_C), colour.xy_to_XYZ(ILLUMINANT_D65),
        transform="Bradford")
    lab = colour.XYZ_to_Lab(XYZ_d65, ILLUMINANT_D65)
    in_gamut = bool(np.all(rgb >= -1e-4) and np.all(rgb <= 1 + 1e-4))
    rgb8 = [int(round(float(c) * 255)) for c in np.clip(rgb, 0, 1)]
    return {
        "xyY": [round(float(v), 6) for v in xyY],
        "XYZ": [round(float(v), 6) for v in XYZ],
        "labD65": [round(float(v), 4) for v in lab],  # CIELAB, D65 white
        "srgb": [round(float(v), 6) for v in rgb],  # unclipped, encoded
        "rgb": rgb8,  # clipped 0-255
        "hex": "#{:02x}{:02x}{:02x}".format(*rgb8),
        "inGamut": in_gamut,
    }


def munsell_notation(spec: np.ndarray) -> str:
    return colour.notation.munsell.munsell_specification_to_munsell_colour(
        colour.notation.munsell.normalise_munsell_specification(spec)
    )


def pccs_to_munsell_unrounded(spec: np.ndarray) -> np.ndarray:
    """
    Same conversion as pccs.pccs_specification_to_munsell_specification, but
    without its final 0.5-step rounding (which is meant for notation display
    and makes chroma jump between neighbouring lightness levels).
    """
    original = pccs.round_align
    pccs.round_align = lambda value, scale: value
    try:
        return pccs.pccs_specification_to_munsell_specification(spec)
    finally:
        pccs.round_align = original


def chromatic_pattern(h: int, l: float, s: int) -> dict:
    spec = np.array([float(h), l, float(s)])
    munsell_spec = pccs.pccs_specification_to_munsell_specification(spec)
    munsell_raw = pccs_to_munsell_unrounded(spec)
    return {
        "notation": pccs.pccs_specification_to_pccs_colour(spec, long=True),
        "tone": pccs.pccs_lightness_and_saturation_to_tone(spec),
        "hue": h,
        "hueName": pccs.PCCS_HUE_CODES[h - 1],
        "lightness": l,
        "saturation": s,
        "munsell": munsell_notation(munsell_spec),
        "munsellSpec": [None if v != v else float(v) for v in munsell_spec],
        "munsellSpecUnrounded": [None if v != v else round(float(v), 4)
                                 for v in munsell_raw],
        # colour is computed from the unrounded Munsell specification
        "color": munsell_to_colour(munsell_raw),
    }


def neutral_pattern(l: float) -> dict:
    spec = np.array([np.nan, l, np.nan, np.nan])
    return {
        "notation": pccs.pccs_specification_to_pccs_colour((0.0, l, 0.0), long=True),
        "name": pccs.pccs_specification_to_pccs_colour((0.0, l, 0.0)),
        "lightness": l,
        "munsell": munsell_notation(spec),
        "color": munsell_to_colour(spec),
    }


def representative_tones() -> list[dict]:
    """Tone symbol (v2, p8, ...) -> (l, s) per hue, as defined by the library."""
    out = []
    for h in HUES:
        for tone in pccs.PCCS_TONE_NAMES:
            l, s = pccs.pccs_tone_to_lightness_and_saturation(float(h), tone)
            out.append({"symbol": f"{tone}{h}", "tone": tone, "hue": h,
                        "lightness": float(l), "saturation": float(s)})
    return out


def compact_lab(chromatic: list[dict], neutrals: list[dict]) -> dict:
    """Compact table for the web app: lab[h-1][li][si] = [L, a, b] | null."""
    def lab(p: dict):
        return p["color"]["labD65"] if p["color"] else None

    table = {(p["hue"], p["lightness"], p["saturation"]): lab(p) for p in chromatic}
    return {
        "hues": HUES,
        "lightnesses": LIGHTNESSES,
        "saturations": SATURATIONS,
        "hueCodes": pccs.PCCS_HUE_CODES,
        "toneCoords": {k: list(v) for k, v in pccs.PCCS_TONE_COORDS.items()},
        "lab": [[[table[(h, l, s)] for s in SATURATIONS] for l in LIGHTNESSES]
                for h in HUES],
        "neutralLab": [lab(n) for n in neutrals],
    }


def main() -> None:
    out_path = Path(sys.argv[1] if len(sys.argv) > 1 else "data/pccs-patterns.json")
    compact_path = Path(sys.argv[2] if len(sys.argv) > 2 else "src/data/pccs-lab.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    compact_path.parent.mkdir(parents=True, exist_ok=True)

    chromatic = [
        chromatic_pattern(h, l, s)
        for h in HUES
        for l in LIGHTNESSES
        for s in SATURATIONS
    ]
    neutrals = [neutral_pattern(l) for l in LIGHTNESSES]

    data = {
        "meta": {
            "source": "pccs 0.2a3 (Python) + colour-science 0.4.7",
            "reference": "Kobayashi, M. & Yoshiki, K. (2001). Mathematical Relation "
                         "among PCCS Tones, PCCS Color Attributes and Munsell Color "
                         "Attributes. J. Color Sci. Assoc. Japan 25(4), 249-261.",
            "pipeline": "PCCS -> Munsell (pccs) -> xyY Ill. C (Munsell Renotation) "
                        "-> Bradford C->D65 -> sRGB",
            "hues": HUES,
            "lightnesses": LIGHTNESSES,
            "saturations": SATURATIONS,
            "counts": {
                "chromatic": len(chromatic),
                "chromaticInRenotation": sum(p["color"] is not None for p in chromatic),
                "chromaticInSrgbGamut": sum(
                    bool(p["color"] and p["color"]["inGamut"]) for p in chromatic),
                "neutral": len(neutrals),
            },
        },
        "hueCodes": pccs.PCCS_HUE_CODES,
        "toneCoords": {k: list(v) for k, v in pccs.PCCS_TONE_COORDS.items()},
        "tones": representative_tones(),
        "neutrals": neutrals,
        "patterns": chromatic,
    }

    out_path.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n")
    compact_path.write_text(
        json.dumps(compact_lab(chromatic, neutrals), separators=(",", ":")) + "\n")
    print(f"wrote {compact_path}")
    print(f"wrote {out_path}: {json.dumps(data['meta']['counts'])}")


if __name__ == "__main__":
    main()
