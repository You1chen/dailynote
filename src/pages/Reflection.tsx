import { useEffect, useState } from 'react';
import { ArrowLeft, Layers } from 'lucide-react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useRouteBack } from '../hooks/useRouteBack';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import DayNavigator from '../components/DayNavigator';
import KnowledgeCardCollector from '../components/KnowledgeCardCollector';
import { todayStr } from '../types';
import './Reflection.css';

export default function ReflectionPage() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const back = useRouteBack();
  const quickComposer = location.state?.fromHomeQuickNote === true;
  const [date, setDate] = useState(params.get('date') || todayStr());
  const [browseCards, setBrowseCards] = useState(false);
  const startWithNewCard = params.get('cards') === 'new';
  const initialCardId = startWithNewCard ? undefined : params.get('card') || undefined;
  const collectorOpen = browseCards || startWithNewCard || !!initialCardId;
  useEffect(() => {
    const next = params.get('date');
    if (next) setDate(next);
  }, [params]);

  function closeCollector() {
    if (quickComposer) { back(); return; }
    setBrowseCards(false);
    if (startWithNewCard || initialCardId) {
      const next = new URLSearchParams(params);
      if (startWithNewCard) next.delete('cards');
      next.delete('card');
      setParams(next, { replace: true });
    }
  }

  useRegisterBackHandler(() => {
    if (collectorOpen) return false;
    back();
    return true;
  }, [back, collectorOpen]);

  return (
    <div className="app-container">
      {!quickComposer && <>
      <header className="page-header">
        <button type="button" className="btn btn-ghost btn-icon" onClick={back} aria-label="返回"><ArrowLeft size={22} /></button>
        <h1 className="page-title">记事</h1>
      </header>
      <DayNavigator date={date} onDateChange={setDate} />
      <div className="reflection-actions">
        <button className="btn btn-outline" onClick={() => setBrowseCards(true)}>
          <Layers size={18} aria-hidden="true" />卡片收集器
        </button>
      </div>
      </>}
      {collectorOpen && <KnowledgeCardCollector
        key={initialCardId ? `card:${initialCardId}` : startWithNewCard ? 'new' : 'browse'}
        initialCardId={initialCardId}
        startWithNewCard={startWithNewCard}
        quickComposer={quickComposer}
        onClose={closeCollector}
      />}
    </div>
  );
}
