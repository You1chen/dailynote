import { Fragment, type MouseEvent, type ReactNode } from 'react';
import type { KnowledgeCard } from '../../types/knowledge';
import { extractCardReferences, resolveCardReference } from '../utils/cardLinks';

interface Props {
  text: string;
  cards: readonly KnowledgeCard[];
  currentId?: string;
  onOpenCard?: (id: string) => void;
  onMissingCard?: (title: string) => void;
  className?: string;
}

interface Token {
  start: number;
  end: number;
  kind: 'ref' | 'url';
  raw: string;
  title?: string;
  href?: string;
}

const URL_PATTERN = /https?:\/\/[^\s<>"']+/g;
const TRAILING_URL_PUNCTUATION = /[),.;!?，。；：！？、）】》]+$/;

function collectTokens(text: string): Token[] {
  const tokens: Token[] = [];
  for (const reference of extractCardReferences(text)) {
    tokens.push({
      start: reference.index,
      end: reference.index + reference.length,
      kind: 'ref',
      raw: reference.raw,
      title: reference.title,
    });
  }
  for (const match of text.matchAll(URL_PATTERN)) {
    let raw = match[0];
    let start = match.index ?? 0;
    let end = start + raw.length;
    const trailing = TRAILING_URL_PUNCTUATION.exec(raw);
    if (trailing) {
      raw = raw.slice(0, -trailing[0].length);
      end -= trailing[0].length;
    }
    if (!raw) continue;
    if (tokens.some(token => start < token.end && end > token.start)) continue;
    tokens.push({ start, end, kind: 'url', raw, href: raw });
  }
  return tokens.sort((left, right) => left.start - right.start);
}

/** Renders card text with clickable `[[page references]]` and external URLs. */
export default function CardRichText({ text, cards, currentId, onOpenCard, onMissingCard, className }: Props) {
  if (!text) return null;
  const tokens = collectTokens(text);
  if (!tokens.length) return <span className={className}>{text}</span>;

  const parts: ReactNode[] = [];
  let cursor = 0;

  const stop = (event: MouseEvent): void => event.stopPropagation();

  tokens.forEach((token, index) => {
    if (token.start > cursor) parts.push(<Fragment key={`text-${index}`}>{text.slice(cursor, token.start)}</Fragment>);
    if (token.kind === 'url') {
      parts.push(
        <a
          key={`url-${index}`}
          className="v-inline-link"
          href={token.href}
          target="_blank"
          rel="noreferrer noopener"
          onClick={stop}
        >
          {token.raw}
        </a>,
      );
    } else {
      const target = token.title ? resolveCardReference(token.title, cards, currentId) : undefined;
      parts.push(
        <button
          key={`ref-${index}`}
          type="button"
          className={`v-inline-link${target ? '' : ' v-inline-link--missing'}`}
          title={target ? `打开「${target.title || '未命名卡片'}」` : '这张卡片还不存在'}
          onClick={event => {
            stop(event);
            if (target) onOpenCard?.(target.id);
            else if (token.title) onMissingCard?.(token.title);
          }}
        >
          {token.raw}
        </button>,
      );
    }
    cursor = token.end;
  });

  if (cursor < text.length) parts.push(<Fragment key="tail">{text.slice(cursor)}</Fragment>);

  return <span className={`v-rich-text${className ? ` ${className}` : ''}`}>{parts}</span>;
}
