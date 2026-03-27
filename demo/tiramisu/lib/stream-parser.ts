export type SectionType =
  | "Analyze"
  | "Understand"
  | "Code"
  | "Execute"
  | "Answer"
  | "File"
  | "RouterGuidance";

export interface ParsedSection {
  id: string;
  type: SectionType;
  content: string;
  isComplete: boolean;
  round: number;
}

const TAG_TYPES: SectionType[] = [
  "Analyze",
  "Understand",
  "Code",
  "Execute",
  "Answer",
  "File",
  "RouterGuidance",
];

const OPEN_RE = /<(Analyze|Understand|Code|Execute|Answer|File|RouterGuidance)>/g;

export function parseSections(content: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  let match: RegExpExecArray | null;
  let round = 1;
  let idx = 0;

  // Reset regex state
  OPEN_RE.lastIndex = 0;

  while ((match = OPEN_RE.exec(content)) !== null) {
    const type = match[1] as SectionType;
    const openEnd = match.index + match[0].length;
    const closeTag = `</${type}>`;
    const closeIdx = content.indexOf(closeTag, openEnd);
    const isComplete = closeIdx !== -1;
    const bodyEnd = isComplete ? closeIdx : content.length;
    const body = content.slice(openEnd, bodyEnd);

    // New round: each <Analyze> after an <Execute> or <Answer> bumps round
    if (type === "Analyze" && idx > 0) round++;

    sections.push({
      id: `${type}-${round}-${idx}`,
      type,
      content: body,
      isComplete,
      round,
    });

    idx++;
    if (isComplete) {
      OPEN_RE.lastIndex = closeIdx + closeTag.length;
    } else {
      break; // currently streaming section
    }
  }

  return sections;
}

/** Extract the "outside" text before the first tag (if any). */
export function getPreTagContent(content: string): string {
  OPEN_RE.lastIndex = 0;
  const match = OPEN_RE.exec(content);
  if (!match) return content;
  return content.slice(0, match.index).trim();
}
