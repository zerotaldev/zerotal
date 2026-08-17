import type { ReactNode } from "react";
import { Code } from "./Code";

/**
 * A translated string with inline code chips.
 *
 * Translating prose that contains identifiers used to mean a choice: keep the
 * `<Code>` styling and leave the sentence in English, or translate it and lose
 * the chips. Neither is acceptable — the identifiers are the same in every
 * language, and the typography is what tells a reader they are identifiers.
 *
 * So the catalog writes them in backticks, exactly as prose does everywhere
 * else, and this renders those spans as chips. A translator moves the backticks
 * with the words around them and never touches what is inside.
 */
export default function Rich({ text }: { text: string }): ReactNode {
  // Split on the delimiter but keep it: odd indices are the code spans.
  return text
    .split("`")
    .map((part, index) =>
      index % 2 === 1 ? <Code key={index}>{part}</Code> : <span key={index}>{part}</span>,
    );
}
