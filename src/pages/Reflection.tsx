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
  const [collectorMode, setCollectorMode] = useState<'browse' | 'new' | null>(params.get('cards') === 'new' ? 'new' : null);
  useEffect(() => {
    const next = params.get('date');
    if (next) setDate(next);
    if (params.get('cards') === 'new') setCollectorMode('new');
  }, [params]);

  function closeCollector() {
    if (quickComposer) { back(); return; }
    setCollectorMode(null);
    if (params.get('cards') === 'new') {
      const next = new URLSearchParams(params);
      next.delete('cards');
      setParams(next, { replace: true });
    }
  }

  useRegisterBackHandler(() => {
    if (collectorMode) return false;
    back();
    return true;
  }, [back, collectorMode]);

  return (
    <div className="app-container">
      {!quickComposer && <>
      <header className="page-header">
        <button type="button" className="btn btn-ghost btn-icon" onClick={back} aria-label="返回"><ArrowLeft size={22} /></button>
        <h1 className="page-title">记事</h1>
      </header>
      <DayNavigator date={date} onDateChange={setDate} />
      <div className="reflection-actions">
        <button className="btn btn-outline" onClick={() => setCollectorMode('browse')}>
          <Layers size={18} aria-hidden="true" />卡片收集器
        </button>
      </div>
      </>}
      {collectorMode && <KnowledgeCardCollector key={collectorMode} startWithNewCard={collectorMode === 'new'} quickComposer={quickComposer} onClose={closeCollector} />}
    </div>
  );
}
