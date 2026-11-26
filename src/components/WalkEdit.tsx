import type { Memory } from '../utils/wanderDeck';
import { collectMemories } from '../utils/wanderDeck';
import { saveCard } from '../db/knowledgeCards';
import KnowledgeCardEditor from './KnowledgeCardEditor';

interface Props {
  memory: Memory;
  onClose: () => void;
  onSaved: (memory: Memory) => void;
}

export default function WalkEdit({ memory, onClose, onSaved }: Props) {
  return <KnowledgeCardEditor
    card={memory.card}
    onSave={async card => { await saveCard(card); onSaved(collectMemories([card])[0]); }}
    onClose={onClose}
  />;
}
