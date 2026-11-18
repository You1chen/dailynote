import { useEffect, useState } from 'react';
import { Lightbulb } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import DayNavigator from '../components/DayNavigator';
import KnowledgeCardCollector from '../components/KnowledgeCardCollector';
import MindSheet from '../components/MindSheet';
import { useIdeas } from '../hooks/useIdeas';
import { todayStr } from '../types';
import './Reflection.css';

export default function ReflectionPage() {
  const [params] = useSearchParams();
  const [date, setDate] = useState(params.get('date') || todayStr());
  const [collectorOpen, setCollectorOpen] = useState(false);
  const [ideaOpen, setIdeaOpen] = useState(params.get('ideas') === '1');
  const { byKind, countByDate } = useIdeas();
  useEffect(() => { const next = params.get('date'); if (next) setDate(next); if (params.get('ideas') === '1') setIdeaOpen(true); }, [params]);
  const count = byKind.idea.filter(item => item.date === date).length;
  return <div className="app-container">
    <DayNavigator date={date} onDateChange={setDate} marks={countByDate()} />
    <div className="reflection-actions">
      <button className="btn btn-primary reflection-idea-btn" onClick={() => setIdeaOpen(true)}><Lightbulb size={18} />灵感{count ? ` ${count}` : ''}</button>
      <button className="btn btn-outline reflection-collector-btn" onClick={() => setCollectorOpen(true)}>卡片收集器</button>
    </div>
    {ideaOpen && <MindSheet initialKind="idea" kinds={['idea']} date={date} onClose={() => setIdeaOpen(false)} />}
    {collectorOpen && <KnowledgeCardCollector onClose={() => setCollectorOpen(false)} />}
  </div>;
}
