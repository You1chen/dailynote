import { useEffect, useState } from 'react';
import { Check, Plus, Tag, X } from 'lucide-react';
import Sheet from './Sheet';
import { saveCard } from '../../db/knowledgeCards';
import type { KnowledgeCard } from '../../types/knowledge';
import { useData } from '../state/DataProvider';
import { useUi } from '../state/ui';
import { cardTitle } from '../utils/cards';

interface Props {
  open: boolean;
  card: KnowledgeCard | null;
  onClose: () => void;
}

function parseKeywords(value: string): string[] {
  return value
    .split(/[,，、\n]/)
    .map(item => item.trim())
    .filter(Boolean);
}

/** 长按关系网节点 → 设置关键词。 */
export default function CardKeywordSheet({ open, card, onClose }: Props) {
  const { reloadCards } = useData();
  const ui = useUi();
  const [keywords, setKeywords] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !card) return;
    setKeywords([...(card.keywords ?? [])]);
    setInput('');
    setError('');
    setBusy(false);
  }, [open, card]);

  if (!card) return null;

  function commitInput() {
    const additions = parseKeywords(input);
    if (!additions.length) {
      setInput('');
      return;
    }
    setKeywords(current => [...new Set([...current, ...additions])].slice(0, 16));
    setInput('');
  }

  async function save() {
    const target = card;
    if (!target || busy) return;
    const nextKeywords = [...new Set([...keywords, ...parseKeywords(input)])].slice(0, 16);
    setBusy(true);
    setError('');
    try {
      await saveCard({ ...target, keywords: nextKeywords });
      await reloadCards();
      ui.toast(nextKeywords.length ? `已设置 ${nextKeywords.length} 个关键词` : '已清除关键词');
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请重试。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      busy={busy}
      title="设置关键词"
      subtitle={cardTitle(card)}
      footer={(
        <>
          <span className="v-tiny v-grow">相同关键词会直接连成确认连线</span>
          <button type="button" className="v-btn v-btn--ghost" onClick={onClose} disabled={busy}>取消</button>
          <button type="button" className="v-btn v-btn--primary" onClick={() => void save()} disabled={busy}>
            {busy ? '保存中…' : '保存'}
          </button>
        </>
      )}
    >
      <div className="v-keyword-intro">
        <span className="v-manual-icon" style={{ width: 34, height: 34, borderRadius: 11 }}><Tag size={17} /></span>
        <p>关键词像 Logseq 的页面名：两张卡片只要有一个相同关键词，就会连成一条确认连线。系统按正文和内容发现的其他关联，会先进入「关联建议」等你确认。留空则清除。</p>
      </div>

      <div className="v-form-group" style={{ marginTop: 14 }}>
        <span className="v-label">关键词</span>
        <div className="v-tag-input">
          {keywords.map(keyword => (
            <span key={keyword} className="v-chip v-chip--soft">
              {keyword}
              <button
                type="button"
                className="v-chip-x"
                aria-label={`移除关键词 ${keyword}`}
                onClick={() => setKeywords(current => current.filter(item => item !== keyword))}
              >
                <X size={10} />
              </button>
            </span>
          ))}
          <input
            value={input}
            onChange={event => setInput(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ',' || event.key === '，') {
                event.preventDefault();
                commitInput();
              }
            }}
            onBlur={commitInput}
            placeholder={keywords.length ? '再加一个…' : '如：线代、考试、项目'}
            aria-label="添加关键词"
          />
        </div>
        <p className="v-tiny" style={{ margin: '5px 2px 0' }}>
          {keywords.length ? `已设置 ${keywords.length} 个关键词` : '还没有关键词，输入后按回车添加。'}
        </p>
      </div>

      <div className="v-row" style={{ marginTop: 4, gap: 6 }}>
        <button type="button" className="v-btn v-btn--soft v-btn--sm" onClick={commitInput}>
          <Plus size={14} /> 添加
        </button>
        {keywords.length > 0 && (
          <button type="button" className="v-btn v-btn--ghost v-btn--sm" onClick={() => setKeywords([])}>
            <Check size={14} /> 清空
          </button>
        )}
      </div>

      {error && <p role="alert" style={{ margin: '12px 2px 0', color: 'var(--v-red)', fontSize: 12.5 }}>{error}</p>}
    </Sheet>
  );
}
