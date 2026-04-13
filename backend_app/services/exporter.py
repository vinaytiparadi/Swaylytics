from __future__ import annotations

import asyncio
import base64
import logging
import mimetypes
import re
import textwrap
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx

from ..settings import settings, IMAGE_EXTENSIONS
from .workspace import (
    build_download_url,
    build_preview_url,
    get_session_workspace,
    register_generated_paths,
    uniquify_path,
)

log = logging.getLogger(__name__)

GEMINI_API_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
)
GEMINI_REPORT_MODEL = "gemini-3.1-pro-preview"
GEMINI_FALLBACK_MODEL = "gemini-3-flash-preview"
_MAX_REPORT_IMAGES = 20
_REPORT_MAX_RETRIES = 2
_REPORT_RETRY_BACKOFF = [2, 4]  # seconds
_REPORT_RETRYABLE_STATUS = {429, 500, 502, 503}


def extract_sections_from_messages(messages: list[dict[str, Any]]) -> str:
    if not isinstance(messages, list):
        return ""

    parts: list[str] = []
    appendix: list[str] = []
    tag_pattern = r"<(Analyze|Understand|Code|Execute|File|Answer)>([\s\S]*?)</\1>"

    for message in messages:
        if (message or {}).get("role") != "assistant":
            continue

        content = str((message or {}).get("content") or "")
        step = 1
        for match in re.finditer(tag_pattern, content, re.DOTALL):
            tag, segment = match.groups()
            segment = segment.strip()
            if tag == "Answer":
                parts.append(f"{segment}\n")
            appendix.append(f"\n### Step {step}: {tag}\n\n{segment}\n")
            step += 1

    final_text = "".join(parts).strip()
    if appendix:
        final_text += (
            "\n\n---\n\n# Appendix: Detailed Process\n"
            + "".join(appendix).strip()
        )
    return final_text


def save_md(md_text: str, base_name: str, workspace_dir: str) -> Path:
    target_dir = Path(workspace_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    md_path = uniquify_path(target_dir / f"{base_name}.md")
    md_path.write_text(md_text, encoding="utf-8")
    return md_path


def _sanitize_filename_component(
    raw: str,
    *,
    fallback: str,
    max_length: int = 80,
) -> str:
    text = str(raw or "").strip()
    if not text:
        return fallback

    # Forbidden Windows filename characters + control characters
    text = re.sub(r'[<>:"/\\|?*\x00-\x1F]+', "_", text)
    text = re.sub(r"\s+", "_", text)
    text = re.sub(r"_+", "_", text).strip(" ._")

    if not text:
        text = fallback

    if len(text) > max_length:
        text = text[:max_length].rstrip(" ._") or fallback

    return text


def _build_export_base_name(title: str, *, prefix: str, timestamp: str) -> str:
    safe_title = _sanitize_filename_component(title, fallback=prefix, max_length=80)
    return f"{safe_title}_{timestamp}"


def _to_file_meta(
    session_id: str,
    workspace_root: Path,
    file_path: Path | None,
) -> dict[str, Any] | None:
    if file_path is None:
        return None
    rel_path = file_path.relative_to(workspace_root).as_posix()
    return {
        "name": file_path.name,
        "path": rel_path,
        "download_url": build_download_url(f"{session_id}/{rel_path}"),
    }


def export_report_from_body(body: dict[str, Any]) -> dict[str, Any]:
    messages = body.get("messages", [])
    if not isinstance(messages, list):
        raise ValueError("messages must be a list")

    title = (body.get("title") or "").strip()
    session_id = body.get("session_id", "default")
    workspace_dir = get_session_workspace(session_id)
    workspace_root = Path(workspace_dir)

    md_text = extract_sections_from_messages(messages)
    if not md_text:
        md_text = "(No <Analyze>/<Understand>/<Code>/<Execute>/<Answer> sections found.)"

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    base_name = _build_export_base_name(title, prefix="Report", timestamp=timestamp)

    export_dir = workspace_root / "generated" / "reports"
    export_dir.mkdir(parents=True, exist_ok=True)

    md_path = save_md(md_text, base_name, str(export_dir))
    register_generated_paths(
        session_id,
        [md_path.relative_to(workspace_root).as_posix()],
    )

    md_meta = _to_file_meta(session_id, workspace_root, md_path)

    return {
        "message": "exported",
        "md": md_path.name,
        "files": {
            "md": md_meta,
        },
        "download_urls": {
            "md": md_meta["download_url"] if md_meta else None,
        },
    }


# ─── HTML Report Generation via Gemini 3.1 Pro ─────────────────────────


def extract_full_analysis_content(
    messages: list[dict[str, Any]],
) -> list[dict[str, str]]:
    """Extract all tagged sections from the conversation, preserving flow."""
    tag_pattern = r"<(Analyze|Understand|Code|Execute|File|Answer|RouterGuidance|Thinking)>([\s\S]*?)</\1>"
    sections: list[dict[str, str]] = []
    prev_was_failed_exec = False

    for msg in messages:
        if not isinstance(msg, dict):
            continue
        role = msg.get("role", "")
        content = str(msg.get("content") or "")

        if role == "user":
            sections.append({"role": "user", "tag": "User", "content": content.strip()})
            prev_was_failed_exec = False
            continue

        if role not in ("assistant",):
            continue

        for match in re.finditer(tag_pattern, content, re.DOTALL):
            tag, segment = match.groups()
            segment = segment.strip()
            if not segment:
                continue

            # Filter consecutive failed Execute blocks (noise from retries)
            is_exec_error = (
                tag == "Execute"
                and any(
                    kw in segment
                    for kw in ("Traceback", "Error", "[Timeout]", "Exception")
                )
            )
            if is_exec_error and prev_was_failed_exec:
                continue  # skip duplicate retry noise
            prev_was_failed_exec = is_exec_error

            sections.append({"role": "assistant", "tag": tag, "content": segment})

    return sections


def collect_artifact_images_base64(
    session_id: str,
    artifacts: list[dict[str, str]] | None = None,
) -> list[dict[str, str]]:
    """Collect workspace images as base64 for embedding in the report."""
    workspace_dir = Path(get_session_workspace(session_id))
    seen: set[str] = set()
    results: list[dict[str, str]] = []

    def _add_image(path: Path) -> None:
        if len(results) >= _MAX_REPORT_IMAGES:
            return
        name = path.name
        if name in seen or not path.is_file():
            return
        suffix = path.suffix.lower()
        if suffix not in IMAGE_EXTENSIONS:
            return
        seen.add(name)
        mime = mimetypes.guess_type(str(path))[0] or "image/png"
        data = base64.b64encode(path.read_bytes()).decode("ascii")
        results.append({"filename": name, "base64_data": data, "mime_type": mime})

    # Scan generated/ directory
    gen_dir = workspace_dir / "generated"
    if gen_dir.is_dir():
        for p in sorted(gen_dir.rglob("*")):
            _add_image(p)

    # Also check explicitly listed artifacts
    if artifacts:
        for art in artifacts:
            art_path = workspace_dir / art.get("path", "")
            _add_image(art_path)

    # Scan workspace root for images not in generated/
    for p in sorted(workspace_dir.iterdir()):
        _add_image(p)

    return results


def _inject_base64_images(html: str, images: list[dict[str, str]]) -> str:
    """Post-process generated HTML to replace image placeholders with base64 data URIs.

    Gemini can see the images (multimodal) but cannot emit the raw base64 string.
    It uses placeholder src attributes that we replace here.

    Strategy: for every <img> whose src does NOT start with "data:", find the best
    matching image from our collection and inject the base64 data URI.
    """
    if not images:
        return html

    # Build lookup by filename (case-insensitive, without extension too)
    by_name: dict[str, dict[str, str]] = {}
    by_stem: dict[str, dict[str, str]] = {}
    for img in images:
        by_name[img["filename"].lower()] = img
        stem = Path(img["filename"]).stem.lower()
        by_stem[stem] = img

    def _find_image(src_value: str) -> dict[str, str] | None:
        """Match a src/alt/data-artifact attribute to a collected image."""
        val = src_value.strip().lower()
        # Direct filename match
        for name, img in by_name.items():
            if name in val:
                return img
        # Stem match (without extension)
        for stem, img in by_stem.items():
            if stem in val:
                return img
        return None

    def _replace_img(match: re.Match) -> str:
        tag = match.group(0)
        # Skip images that already have base64 data URIs
        if "data:" in tag and ";base64," in tag:
            return tag

        # Try to find the referenced image from src, alt, or data-artifact
        img = None
        for attr in ("src", "alt", "data-artifact", "data-src"):
            attr_match = re.search(rf'{attr}=["\']([^"\']*)["\']', tag)
            if attr_match:
                img = _find_image(attr_match.group(1))
                if img:
                    break

        if not img:
            # Fallback: try matching any filename mentioned anywhere in the tag
            for name, candidate in by_name.items():
                if name.split(".")[0] in tag.lower():
                    img = candidate
                    break

        if img:
            data_uri = f"data:{img['mime_type']};base64,{img['base64_data']}"
            # Replace or inject src attribute
            if re.search(r'src=["\']', tag):
                tag = re.sub(
                    r'src=["\'][^"\']*["\']',
                    f'src="{data_uri}"',
                    tag,
                    count=1,
                )
            else:
                tag = tag.replace("<img", f'<img src="{data_uri}"', 1)

        return tag

    return re.sub(r"<img\b[^>]*>", _replace_img, html, flags=re.IGNORECASE)


_THEME_INSTRUCTIONS: dict[str, str] = {
    "literature": (
        "ROLE & AESTHETIC VISION:\n"
        "You are an expert frontend developer specializing in digital typesetting\n"
        "and editorial design. Build a web UI based on the 'CLASSIC LITERARY\n"
        "BROADSHEET' theme. Think: a high-end literary magazine crossed with a\n"
        "vintage 1920s newspaper — elegant, intensely typographic, and\n"
        "authentically print-like. The screen should feel like ink pressed into\n"
        "warm paper.\n"
        "\n"
        "COLOR PALETTE & TYPOGRAPHY:\n"
        "- Background: Soft, warm off-white or light sepia (#F4F1EB or #FAF8F5)\n"
        "  to mimic vintage paper.\n"
        "- Text: Dark, soft charcoal (#2B2B2B) instead of pure black to reduce\n"
        "  eye strain and mimic faded ink.\n"
        "- Accents: Faded burgundy (#8A3324) or classic navy (#1A2421) used\n"
        "  sparingly for hover states, active links, or subtle highlights.\n"
        "- Selection State: When text is highlighted, use a very pale version of\n"
        "  the accent color with charcoal text to maintain the vintage illusion.\n"
        "- Fonts: Use Playfair Display or Cinzel for dramatic, elegant headings\n"
        "  and the masthead. Use Merriweather or Georgia for highly readable,\n"
        "  dense body copy.\n"
        "- Drop Caps: Implement a classic drop cap using the ::first-letter\n"
        "  pseudo-element for the very first paragraph of the main article.\n"
        "  It should drop exactly 3 lines deep in the primary accent color.\n"
        "\n"
        "LAYOUT & ARCHITECTURE:\n"
        "- Grid: Utilize CSS Grid or Flexbox to create a rigorous multi-column\n"
        "  layout (2 or 3 columns on desktop) reminiscent of a newspaper print\n"
        "  grid.\n"
        "- Header/Masthead: A prominent, full-width, stylized masthead at the\n"
        "  top. Center the main title with a massive, elegant serif size,\n"
        "  flanked by the date or issue number in small caps.\n"
        "- Text Alignment: Use text-align: justify combined with hyphens: auto\n"
        "  to create dense, blocky paragraphs just like a printed column.\n"
        "\n"
        "UI COMPONENTS & ASSETS:\n"
        "- Separators: Use thin, elegant CSS border lines (1px solid or 3px\n"
        "  double) to separate columns, distinct sections, and the masthead.\n"
        "  Use <hr> tags styled as vintage section breaks.\n"
        "- Anti-Modern Styling: Keep it entirely flat and crisp. ZERO modern UI\n"
        "  elements. No box-shadow, no border-radius (keep all corners 90\n"
        "  degrees), and no gradients.\n"
        "- Images & Figures: If rendering images, apply a subtle CSS filter\n"
        "  (filter: sepia(0.2) contrast(1.1) grayscale(0.5)) to make them feel\n"
        "  like vintage photo-lithographs. Captions should sit directly below\n"
        "  in a small, italicized serif font.\n"
        "\n"
        "TECHNICAL & ACCESSIBILITY CONSTRAINTS:\n"
        "- Ensure text contrast between charcoal text and off-white background\n"
        "  meets WCAG AA or AAA standards.\n"
        "- Mobile Degradation: The multi-column layout must collapse beautifully\n"
        "  into a single, well-padded column on mobile devices without losing\n"
        "  the print-like typographic scale.\n"
        "- Ensure the line-height (leading) is spacious enough for readability\n"
        "  but tight enough to maintain the illusion of a printed book."
    ),
    "academic": (
        "ROLE & AESTHETIC VISION:\n"
        "You are an expert frontend developer with an eye for avant-garde,\n"
        "academic typography. Build a web UI based on the 'BRUTALIST GEOMETRIC\n"
        "RESEARCH LAB' theme. Think: 1960s IBM research paper crossed with\n"
        "brutalist web design — rigorous, intellectual, and powerfully\n"
        "unconventional. Let the geometry speak.\n"
        "\n"
        "COLOR PALETTE & TYPOGRAPHY:\n"
        "- Background: Crisp, stark white canvas (#FFFFFF or #FAFAFA).\n"
        "- Primary Accent: Hyper-bold forest-green (#0A3D2A). Use this\n"
        "  strategically for active states, primary buttons, or key geometric\n"
        "  accents.\n"
        "- Text: Deep charcoal or pure black for maximum contrast.\n"
        "- Selection State: When text is highlighted, use the forest-green\n"
        "  background with pure white text to ensure absolute readability.\n"
        "- Fonts: Use STIX Two Text, Computer Modern, or a similar high-quality\n"
        "  serif for razor-sharp academic authority. Headings should be in\n"
        "  heavy, geometric sans-serif weights (e.g., Space Grotesk or\n"
        "  Helvetica Neue in bold).\n"
        "\n"
        "LAYOUT & ARCHITECTURE:\n"
        "- Grid: Implement a strict, visible, modular CSS grid. Borders between\n"
        "  sections can be harsh, 1px solid black or dark gray lines.\n"
        "- Navigation: A floating, sticky sidebar Table of Contents on the\n"
        "  left.\n"
        "- Numbering & Alignment (CRITICAL): For all numbered headings and\n"
        "  Table of Contents entries, use CSS Flexbox or Grid to strictly\n"
        "  separate the numeral from the title text. Establish a defined gap\n"
        "  (e.g., gap: 1rem) so text never collides with the numbers. If a\n"
        "  long title wraps to a second line, it must align flush with the\n"
        "  text above it, maintaining a rigid vertical axis separate from\n"
        "  the numeral column.\n"
        "\n"
        "UI COMPONENTS & ASSETS:\n"
        "- Separators: Use bold, geometric HR lines or thick black rules to\n"
        "  divide sections. No decorative fluff.\n"
        "- Figures & Tables: Wrap in rigid, bordered containers with numbered\n"
        "  captions (e.g., 'Figure 1:', 'Table 2:'). Use monospaced fonts\n"
        "  for data tables.\n"
        "- Footnotes: Use superscript numbers linked to a footnotes section\n"
        "  at the bottom, just like a real research paper.\n"
        "\n"
        "TECHNICAL & ACCESSIBILITY CONSTRAINTS:\n"
        "- Ensure text contrast meets WCAG AA standards.\n"
        "- Mobile Degradation: The sidebar TOC collapses into a top sticky\n"
        "  nav on mobile. The strict grid relaxes to single-column while\n"
        "  retaining the brutalist borders and geometric feel."
    ),
    "dossier": (
        "ROLE & AESTHETIC VISION:\n"
        "You are an expert frontend developer specializing in high-fidelity analog\n"
        "interfaces and 'skeuomorphic-lite' design. Build a web UI based on the\n"
        "'REDACTED CLASSIFIED DOSSIER' theme. Think: a 1970s intelligence file\n"
        "pulled from a secure vault. The screen should feel like heavy manila\n"
        "cardstock, stamped ink, and typewritten urgency. It is gritty, analog,\n"
        "and authoritative.\n"
        "\n"
        "COLOR PALETTE & TYPOGRAPHY:\n"
        "- Background: A textured, warm manila/folder beige (#E6D5B8).\n"
        "- Text: Typewriter ribbon black (#1A1A1A) with slight opacity variations\n"
        "  to mimic uneven ink distribution.\n"
        "- Accents: 'Urgent' Stamp Red (#B22222) for high-level warnings and\n"
        "  'Field Agent' Blue (#1F3A5F) for links and metadata.\n"
        "- Fonts: Use 'Special Elite' or 'Courier Prime' for all body text to\n"
        "  replicate a strike-on-ribbon typewriter. Headings should be in a\n"
        "  heavy, condensed sans-serif like 'Bebas Neue' or 'Archivo Black',\n"
        "  resembling physical rubber stamps.\n"
        "\n"
        "LAYOUT & ARCHITECTURE:\n"
        "- Paper Effect: The main content container should have a subtle inner\n"
        "  shadow (inset 0 0 50px rgba(0,0,0,0.05)) to suggest the depth of a\n"
        "  physical folder.\n"
        "- Redaction System: Implement a 'Classified' component where sensitive\n"
        "  data or technical jargon is covered by a solid black bar (#000000).\n"
        "  On hover, the bar should fade to 10% opacity to reveal the 'secret' text.\n"
        "- Marginalia: Use a small, blue, 'handwritten' font (e.g., 'Nanum Pen\n"
        "  Script') for side-notes or annotations in the right-hand margin.\n"
        "\n"
        "UI COMPONENTS & ASSETS:\n"
        "- Stamps: Create CSS-based stamps (e.g., 'TOP SECRET' or 'CONFIDENTIAL')\n"
        "  using thick double-borders, rotated at -12 degrees, with a high-transparency\n"
        "  red ink color and a grainy filter.\n"
        "- Paperclip: Add a fixed/sticky CSS element in the top-right corner that\n"
        "  visually 'clips' a summary memo to the main report.\n"
        "- Redacted HR: Use a heavy, 4px solid black line to separate major\n"
        "  intelligence sections.\n"
        "\n"
        "TECHNICAL & ACCESSIBILITY CONSTRAINTS:\n"
        "- Maintain high contrast between the typewriter black and manila background.\n"
        "- Mobile Degradation: Ensure the 'handwritten' marginalia moves below the\n"
        "  main text blocks on mobile to avoid horizontal scrolling."
    ),
    "blueprint": (
        "ROLE & AESTHETIC VISION:\n"
        "You are an expert frontend developer specializing in technical drafting\n"
        "visuals and retro-computing interfaces. Build a web UI based on the\n"
        "'ARCHITECTURAL BLUEPRINT TERMINAL' theme. Think: a mid-century CAD\n"
        "workstation or a high-end engineering schematic. The interface should\n"
        "feel mathematically precise, illuminated, and structurally transparent.\n"
        "\n"
        "COLOR PALETTE & TYPOGRAPHY:\n"
        "- Background: Deep, matte Blueprint Blue (#003366) with a faint 10px\n"
        "  cyan grid pattern (background-image: radial-gradient).\n"
        "- Text: Electric Cyan (#00FFFF) for primary data and Phosphorus Green\n"
        "  (#32CD32) for success states and secondary metrics.\n"
        "- Accents: Bright White (#FFFFFF) for thin structural lines and axes.\n"
        "- Fonts: Use 'JetBrains Mono', 'Roboto Mono', or 'Space Mono' for all\n"
        "  text. Every character must feel like it belongs on a coordinate plane.\n"
        "\n"
        "LAYOUT & ARCHITECTURE:\n"
        "- Schematic Grid: Use CSS Grid to create a layout where every section is\n"
        "  boxed by 1px cyan borders with 30% opacity.\n"
        "- Dimension Lines: Add 'measurement' markers to containers using pseudo-\n"
        "  elements (e.g., thin lines with arrows pointing to the width/height\n"
        "  of a chart, labeled in a tiny 10px font).\n"
        "- Crosshairs: Place 10px '+' crosshair symbols at the four corners of\n"
        "  the main data dashboard to ground the 'drafting' aesthetic.\n"
        "\n"
        "UI COMPONENTS & ASSETS:\n"
        "- Glowing Elements: Apply a subtle `text-shadow: 0 0 5px rgba(0, 255, 255, 0.5)`\n"
        "  to headings to simulate a CRT phosphorus glow.\n"
        "- Technical Callouts: When highlighting a data point, use a thin white\n"
        "  diagonal line (45 degrees) leading to a boxed label, mimicking an\n"
        "  engineering callout.\n"
        "- Scanning Line: Implement a slow, 5-second CSS animation of a 1px\n"
        "  horizontal line with a slight gradient that travels from the top to\n"
        "  bottom of the viewport.\n"
        "\n"
        "TECHNICAL & ACCESSIBILITY CONSTRAINTS:\n"
        "- Ensure the Electric Cyan on Deep Blue meets WCAG AA contrast ratios.\n"
        "- Mobile Degradation: The scanning line and complex dimension markers\n"
        "  should be disabled on mobile to prioritize performance and legibility."
    ),
    "aura": (
        "ROLE & AESTHETIC VISION:\n"
        "You are an expert frontend developer specializing in future-organic\n"
        "interfaces where biology meets extreme precision engineering. Build a\n"
        "web UI based on the 'BIOMORPHIC SCHEMATIC' theme. Think: the interior\n"
        "of a futurist, curve-driven Zaha Hadid architectural pod, but outfitted\n"
        "with rigid, technically precise drafting screens. Every element must\n"
        "feel organic yet structurally bold. This is advanced, functional\n"
        "biomimicry.\n"
        "\n"
        "COLOR PALETTE & TYPOGRAPHY:\n"
        "- Background: A rich, warm matte chalk-paper tone (#F4EFEA).\n"
        "- Accents: A deep, highly saturated forest-green (#052F20) for primary\n"
        "  data lines and structural headings, paired with a vibrant burnt\n"
        "  terracotta (#A3432A) to eliminate any washed-out feeling.\n"
        "- Text: High-contrast, near-black charcoal (#151515) for absolute\n"
        "  legibility.\n"
        "- Fonts: Use sophisticated, technical geometric sans-serifs like\n"
        "  'Inter', 'Aeonik', or 'Suisse Int'l'. Text must be set with\n"
        "  architectural precision.\n"
        "\n"
        "LAYOUT & ARCHITECTURE:\n"
        "- Shapes (The Curves): The major background containers and section\n"
        "  divisions must be large, fluid, non-geometric biomorphic shapes,\n"
        "  using complex asymmetrical CSS border-radiuses (e.g.,\n"
        "  border-radius: 50% 30% 60% 40% / 40% 60% 30% 70%), mimicking cell\n"
        "  structures or contour lines.\n"
        "- Layout: Containers should overlap subtly like natural leaves or\n"
        "  scales. Transitions between sections are sweeping, fluid bezier\n"
        "  curves.\n"
        "\n"
        "UI COMPONENTS & ASSETS:\n"
        "- Layering: Retain the layered, crisp 'offset shadow' effect, but make\n"
        "  it significantly bolder and higher-opacity to create deep contrast\n"
        "  (e.g., box-shadow: 3px 3px 0px #C8B8A3, 6px 6px 0px #A3432A)\n"
        "  mimicking thick, stacked technical drafting layers.\n"
        "\n"
        "- Diagrams & Data (CRITICAL FUNCTION): To ensure diagrams are\n"
        "  perfectly readable, they must NEVER be clipped by an organic curve.\n"
        "  Use a 'Diagram Docking Slate' system. Text and captions sit in the\n"
        "  fluid, organic outer shapes. However, charts must be socketed into\n"
        "  rigid, sharp, 90-degree rectangular slates that are nested *inside*\n"
        "  the curved biomorphic container. These slates must use the inner\n"
        "  padding necessary so the entire diagram (axes, labels, and legend)\n"
        "  is perfectly centered, visible, and un-clipped. Text captions sit\n"
        "  in the fluid sections, pointing to the rigid data slate.\n"
        "\n"
        "- Corners: Inside the fluid biomorphic outer container, add bold,\n"
        "  sharp, 90-degree technical crosshair (+) or L-bracket corner markers\n"
        "  using CSS ::before and ::after pseudo-elements around the\n"
        "  rectangular data docking slates, visualizing the engineering and\n"
        "  adding explicit 'corners.' This creates the ultimate\n"
        "  biomorphic-engineering contrast.\n"
        "\n"
        "- Interaction: On hover, the fluid outer container gently morphs its\n"
        "  asymmetrical curves while the technical inner data slate remains\n"
        "  rock-steady, with its framing brackets slightly increasing in\n"
        "  thickness.\n"
        "\n"
        "TECHNICAL & ACCESSIBILITY CONSTRAINTS:\n"
        "- Ensure strict mobile responsiveness where the complex organic network\n"
        "  stacks vertically.\n"
        "- Text labels must maintain WCAG AAA contrast against all background\n"
        "  layers."
    ),
    "surprise": (
        "SURPRISE ME THEME:\n"
        "You have COMPLETE creative freedom. Pick a bold, unexpected, and\n"
        "highly specific design direction that nobody would expect for a data\n"
        "analysis report. Commit FULLY to the aesthetic, creating a cohesive,\n"
        "immersive experience that makes the user say 'wow'.\n"
        "\n"
        "INSPIRATION (feel free to invent your own):\n"
        "- Retro terminal / hacker UI\n"
        "- Vintage newspaper front-page\n"
        "- 1960s science magazine\n"
        "- Cyberpunk neon cityscape\n"
        "- Hand-drawn architect sketchbook\n"
        "- Brutalist web design\n"
        "- Elegant 1920s art deco\n"
        "- Vaporwave glitch\n"
        "- Comic book panels\n"
        "- Dark academia\n"
        "- Space exploration mission brief\n"
        "- Y2K chrome and bubblegum\n"
        "- Medieval illuminated manuscript\n"
        "- 8-bit arcade pixel art\n"
        "- High-fashion editorial lookbook\n"
        "- Vintage 1950s diner menu\n"
        "- Windows 95 corporate memo\n"
        "- Botanical field guide with floral borders\n"
        "- Neon noir detective corkboard\n"
        "- Stained glass cathedral window\n"
        "- Subway map navigation system\n"
        "- Bauhaus minimalist poster\n"
        "- Cassette tape cover art\n"
        "- Top-secret redacted government dossier\n"
        "- Origami folded paper interface\n"
        "- Psychedelic 1970s rock poster\n"
        "- Victorian steampunk clockwork\n"
        "\n"
        "RULES:\n"
        "- Pick ONE distinct style and execute it flawlessly with CSS.\n"
        "- Ensure the underlying data remains fully legible amidst the\n"
        "  extreme stylization.\n"
        "- The design must be cohesive — every element should reinforce the\n"
        "  chosen aesthetic."
    ),
}

_FRONTEND_DESIGN_SKILL = """\
---
name: frontend-design
description: Create distinctive, production-grade frontend interfaces with high design quality. Use this skill when the user asks to build web components, pages, artifacts, posters, or applications (examples include websites, landing pages, dashboards, React components, HTML/CSS layouts, or when styling/beautifying any web UI). Generates creative, polished code and UI design that avoids generic AI aesthetics.
license: Complete terms in LICENSE.txt
---

This skill guides creation of distinctive, production-grade frontend interfaces that avoid generic "AI slop" aesthetics. Implement real working code with exceptional attention to aesthetic details and creative choices.

The user provides frontend requirements: a component, page, application, or interface to build. They may include context about the purpose, audience, or technical constraints.

## Design Thinking

Before coding, understand the context and commit to a BOLD aesthetic direction:
- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: Pick an extreme: brutally minimal, maximalist chaos, retro-futuristic, organic/natural, luxury/refined, playful/toy-like, editorial/magazine, brutalist/raw, art deco/geometric, soft/pastel, industrial/utilitarian, etc. There are so many flavors to choose from. Use these for inspiration but design one that is true to the aesthetic direction.
- **Constraints**: Technical requirements (framework, performance, accessibility).
- **Differentiation**: What makes this UNFORGETTABLE? What's the one thing someone will remember?

**CRITICAL**: Choose a clear conceptual direction and execute it with precision. Bold maximalism and refined minimalism both work - the key is intentionality, not intensity.

Then implement working code (HTML/CSS/JS, React, Vue, etc.) that is:
- Production-grade and functional
- Visually striking and memorable
- Cohesive with a clear aesthetic point-of-view
- Meticulously refined in every detail

## Frontend Aesthetics Guidelines

Focus on:
- **Typography**: Choose fonts that are beautiful, unique, and interesting. Avoid generic fonts like Arial and Inter; opt instead for distinctive choices that elevate the frontend's aesthetics; unexpected, characterful font choices. Pair a distinctive display font with a refined body font.
- **Color & Theme**: Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant colors with sharp accents outperform timid, evenly-distributed palettes.
- **Motion**: Use animations for effects and micro-interactions. Prioritize CSS-only solutions for HTML. Use Motion library for React when available. Focus on high-impact moments: one well-orchestrated page load with staggered reveals (animation-delay) creates more delight than scattered micro-interactions. Use scroll-triggering and hover states that surprise.
- **Spatial Composition**: Unexpected layouts. Asymmetry. Overlap. Diagonal flow. Grid-breaking elements. Generous negative space OR controlled density.
- **Backgrounds & Visual Details**: Create atmosphere and depth rather than defaulting to solid colors. Add contextual effects and textures that match the overall aesthetic. Apply creative forms like gradient meshes, noise textures, geometric patterns, layered transparencies, dramatic shadows, decorative borders, custom cursors, and grain overlays.

NEVER use generic AI-generated aesthetics like overused font families (Inter, Roboto, Arial, system fonts), cliched color schemes (particularly purple gradients on white backgrounds), predictable layouts and component patterns, and cookie-cutter design that lacks context-specific character.

Interpret creatively and make unexpected choices that feel genuinely designed for the context. No design should be the same. Vary between light and dark themes, different fonts, different aesthetics. NEVER converge on common choices (Space Grotesk, for example) across generations.

**IMPORTANT**: Match implementation complexity to the aesthetic vision. Maximalist designs need elaborate code with extensive animations and effects. Minimalist or refined designs need restraint, precision, and careful attention to spacing, typography, and subtle details. Elegance comes from executing the vision well.

Remember: Gemini is capable of extraordinary creative work. Don't hold back, show what can truly be created when thinking outside the box and committing fully to a distinctive vision.
"""


def _build_html_report_prompt(
    analysis_content: list[dict[str, str]],
    images: list[dict[str, str]],
    report_theme: str,
    title: str,
) -> str:
    """Build the mega-prompt for Gemini to generate the HTML report."""

    # Format the analysis content — exclude Code blocks, keep insights and outputs
    content_parts: list[str] = []
    for section in analysis_content:
        tag = section["tag"]
        content = section["content"]
        if tag == "User":
            content_parts.append(f"## USER REQUEST\n{content}\n")
        elif tag in ("Analyze", "Understand", "Thinking"):
            content_parts.append(f"## AGENT REASONING\n{content}\n")
        elif tag == "Execute":
            content_parts.append(f"## EXECUTION OUTPUT\n```\n{content}\n```\n")
        elif tag == "Answer":
            content_parts.append(f"## FINAL ANSWER\n{content}\n")
        elif tag == "File":
            content_parts.append(f"## GENERATED FILES\n{content}\n")
        elif tag == "RouterGuidance":
            content_parts.append(f"## SENIOR ANALYST GUIDANCE\n{content}\n")
        # NOTE: Code blocks are intentionally excluded from the report content

    analysis_text = "\n---\n\n".join(content_parts)

    # Image reference list — tell Gemini to use placeholder src we'll replace
    image_refs = ""
    if images:
        img_list = "\n".join(
            f"  - {img['filename']}"
            for img in images
        )
        image_refs = f"""
## Available Visualizations/Charts (CRITICAL — MUST USE ALL)
The following images were generated during the analysis. They are provided as inline
images in this request so you can SEE them. You MUST include ALL of them prominently
in the report — they are the most important part.

For each image, use an <img> tag with the EXACT filename as the src attribute:
  <img src="{{filename}}" alt="descriptive caption" class="..." />

For example: <img src="scatter_plot.png" alt="Scatter plot of X vs Y" />

The system will automatically replace these filenames with the actual embedded image
data after generation. Just use the exact filename as src.

Images to embed:
{img_list}

Place each image at the most contextually appropriate location in the report.
Add descriptive figure captions and interpretations for each visualization.
Make the visualizations the CENTERPIECE of the report — they should be large,
prominent, and beautifully framed within the design.
"""

    theme_instruction = _THEME_INSTRUCTIONS.get(
        report_theme, _THEME_INSTRUCTIONS["literature"]
    )

    report_title = title.strip() or "Data Analysis Report"

    return textwrap.dedent(f"""\
        You are an elite frontend designer AND expert data analyst creating a stunning
        web-based report. Your task: transform the raw analysis data below into a
        beautiful, self-contained HTML page that a data analyst would be proud to share.

        # REPORT TITLE
        {report_title}

        # DESIGN THEME
        {theme_instruction}

        # FRONTEND DESIGN SKILL
        Use your frontend design skill for achieving below results:
        {_FRONTEND_DESIGN_SKILL}

        # TECHNICAL REQUIREMENTS
        - Output a single, complete, self-contained HTML file
        - Use Tailwind CSS via CDN: <script src="https://cdn.tailwindcss.com"></script>
        - Use Google Fonts via CDN for typography
        - For images: use the exact filename as the src attribute (they will be
          replaced with base64 data URIs automatically after generation)
        - Responsive design (works on mobile and desktop)
        - Print-friendly (use @media print for clean printing)
        - No external JavaScript dependencies beyond Tailwind
        - Start with <!DOCTYPE html> and include proper <head> with meta tags

        Always think extra and ultra unique and creative designs, layout and big fonts and never present any generic design.

        # CONTENT INSTRUCTIONS
        - Read through ALL the analysis content below carefully
        - Extract the key insights, findings, and conclusions and detailed report.
        - Filter out debugging noise, error messages, and redundant retry attempts
        - This is just a high level guidelines, always use your judgement and can structure the report in any way considering the dataset and analysis.
        - Add your own knowledge and insights to the report to make it detailed and comprehensive.
        - DO NOT include any code snippets or code blocks in the report — this is
          for a non-technical audience. Focus on insights, not implementation.
        - Make data visualizations (embedded images) the CENTERPIECE of the report —
          they should be large, prominent, and beautifully framed
        - Make sure the images are large enough so as the visualizations are clearly readable and understandable.
        - Add contextual captions and interpretations for each visualization
        - Use data tables where appropriate to present key metrics
        - Include ALL generated artifacts/visualizations — do not skip any
        - The target audience is a data analyst but make it very easy to understand and present in a creative way.
                
        {image_refs}

        # FULL ANALYSIS CONTENT
        Below is the complete agent analysis session. Parse it, extract what matters,
        and transform it into the report:

        {analysis_text}

        # OUTPUT
        Return ONLY the complete HTML code. No explanations, no markdown fences — just
        the raw HTML starting with <!DOCTYPE html>.
    """)


def _extract_html_from_response(data: dict[str, Any]) -> str:
    """Extract HTML content from a Gemini API response, skipping thinking parts."""
    text_parts: list[str] = []
    for candidate in data.get("candidates", []):
        for part in candidate.get("content", {}).get("parts", []):
            if "text" in part and not part.get("thought"):
                text_parts.append(part["text"])

    raw = "".join(text_parts).strip()

    # Strip markdown fences if present
    fence_match = re.search(r"```html\s*([\s\S]*?)\s*```", raw)
    if fence_match:
        return fence_match.group(1).strip()

    # Try to extract from <!DOCTYPE or <html
    doctype_match = re.search(r"(<!DOCTYPE[\s\S]*)", raw, re.IGNORECASE)
    if doctype_match:
        return doctype_match.group(1).strip()

    html_match = re.search(r"(<html[\s\S]*)", raw, re.IGNORECASE)
    if html_match:
        return html_match.group(1).strip()

    return raw


async def _call_gemini_report_single(
    model: str,
    prompt_text: str,
    images: list[dict[str, str]],
    thinking_level: str = "medium",
) -> str:
    """Call a single Gemini model with retry logic for transient errors."""
    url = GEMINI_API_URL.format(model=model)

    parts: list[dict[str, Any]] = [{"text": prompt_text}]
    for img in images:
        parts.append(
            {
                "inline_data": {
                    "mime_type": img["mime_type"],
                    "data": img["base64_data"],
                }
            }
        )

    payload: dict[str, Any] = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "temperature": 1,
            "maxOutputTokens": 65536,
            "thinkingConfig": {"thinkingLevel": thinking_level},
        },
    }

    timeout = httpx.Timeout(connect=30, read=180, write=30, pool=30)
    last_exc: Exception | None = None
    async with httpx.AsyncClient(timeout=timeout) as client:
        for attempt in range(_REPORT_MAX_RETRIES):
            try:
                log.info(
                    "Calling Gemini %s for HTML report (%d parts, attempt %d/%d)...",
                    model, len(parts), attempt + 1, _REPORT_MAX_RETRIES,
                )
                resp = await client.post(
                    url,
                    headers={"x-goog-api-key": settings.gemini_api_key},
                    json=payload,
                )
                if resp.status_code in _REPORT_RETRYABLE_STATUS:
                    wait = _REPORT_RETRY_BACKOFF[min(attempt, len(_REPORT_RETRY_BACKOFF) - 1)]
                    log.warning(
                        "Gemini report %s returned %s, retrying in %ds (attempt %d/%d)",
                        model, resp.status_code, wait, attempt + 1, _REPORT_MAX_RETRIES,
                    )
                    last_exc = httpx.HTTPStatusError(
                        f"{resp.status_code}", request=resp.request, response=resp,
                    )
                    await asyncio.sleep(wait)
                    continue
                if resp.status_code != 200:
                    log.error("Gemini API error %d: %s", resp.status_code, resp.text[:1000])
                resp.raise_for_status()
                data = resp.json()
                log.info("Gemini %s report response received, candidates=%d", model, len(data.get("candidates", [])))
                return _extract_html_from_response(data)
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code in _REPORT_RETRYABLE_STATUS:
                    last_exc = exc
                    wait = _REPORT_RETRY_BACKOFF[min(attempt, len(_REPORT_RETRY_BACKOFF) - 1)]
                    log.warning(
                        "Gemini report %s HTTP %s, retrying in %ds (attempt %d/%d)",
                        model, exc.response.status_code, wait, attempt + 1, _REPORT_MAX_RETRIES,
                    )
                    await asyncio.sleep(wait)
                    continue
                raise

    if last_exc:
        raise last_exc
    raise RuntimeError(f"Gemini report ({model}): all retries exhausted")


async def _call_gemini_report(
    prompt_text: str,
    images: list[dict[str, str]],
) -> tuple[str, str]:
    """Call Gemini for HTML report with fallback from 3.1 Pro to 3 Flash.

    Returns ``(html_content, model_used)``."""
    # Primary: Gemini 3.1 Pro Preview
    try:
        html = await _call_gemini_report_single(
            GEMINI_REPORT_MODEL, prompt_text, images, thinking_level="medium",
        )
        return html, GEMINI_REPORT_MODEL
    except Exception as primary_exc:
        log.warning(
            "Primary report model %s failed (%s), falling back to %s",
            GEMINI_REPORT_MODEL, primary_exc, GEMINI_FALLBACK_MODEL,
        )

    # Fallback: Gemini 3 Flash Preview with high reasoning
    html = await _call_gemini_report_single(
        GEMINI_FALLBACK_MODEL, prompt_text, images, thinking_level="high",
    )
    return html, GEMINI_FALLBACK_MODEL


async def export_html_report_from_body(body: dict[str, Any]) -> dict[str, Any]:
    """Generate a beautiful HTML report from analysis messages via Gemini."""
    if not settings.gemini_api_key.strip():
        raise ValueError("GEMINI_API_KEY is not configured")

    messages = body.get("messages", [])
    if not isinstance(messages, list) or not messages:
        raise ValueError("messages must be a non-empty list")

    title = (body.get("title") or "").strip()
    session_id = body.get("session_id", "default")
    report_theme = body.get("report_theme", "literature")
    artifacts = body.get("artifacts") or []

    workspace_dir = get_session_workspace(session_id)
    workspace_root = Path(workspace_dir)

    # 1. Extract analysis content
    analysis_content = extract_full_analysis_content(messages)
    if not analysis_content:
        raise ValueError("No analysis content found in messages")

    # 2. Collect images
    images = collect_artifact_images_base64(session_id, artifacts)
    log.info(
        "HTML report: %d sections, %d images for session %s",
        len(analysis_content),
        len(images),
        session_id,
    )

    # 3. Build prompt
    prompt = _build_html_report_prompt(analysis_content, images, report_theme, title)

    # 4. Call Gemini to generate HTML (with fallback)
    html_content, model_used = await _call_gemini_report(prompt, images)
    fallback = model_used != GEMINI_REPORT_MODEL

    # 5. Post-process: inject actual base64 data URIs into image placeholders
    html_content = _inject_base64_images(html_content, images)
    log.info("Post-processed HTML: injected base64 images")

    # 6. Save HTML
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    base_name = _build_export_base_name(title, prefix="Report", timestamp=timestamp)
    export_dir = workspace_root / "generated" / "reports"
    export_dir.mkdir(parents=True, exist_ok=True)
    html_path = uniquify_path(export_dir / f"{base_name}.html")
    html_path.write_text(html_content, encoding="utf-8")

    rel_path = html_path.relative_to(workspace_root).as_posix()
    register_generated_paths(session_id, [rel_path])

    # Use preview URL (inline, no download header) so browser renders the HTML
    view_url = build_preview_url(f"{session_id}/{rel_path}")

    return {
        "message": "html_report_generated",
        "html_file": html_path.name,
        "view_url": view_url,
        "rel_path": rel_path,
        "model_used": model_used,
        "fallback": fallback,
    }
