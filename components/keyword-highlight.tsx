import { normalize } from "@/lib/property-search";

export function KeywordHighlight({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return text;
  return text.split(/(\s+)/).map((part, i) =>
    terms.some(term => normalize(part).includes(term)) ? <mark className="rental-keyword-match" key={i}>{part}</mark> : part
  );
}
