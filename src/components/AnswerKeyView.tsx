import React from 'react';
import { AnswerKeyTemplateManager } from './AnswerKeyTemplateManager.tsx';

interface Props {
  questionsCount: number;
  setQuestionsCount: (n: number) => void;
  columnsCount: number;
  setColumnsCount: (n: number) => void;
  optionsCount: number;
  setOptionsCount: (n: number) => void;
  answerKey: Record<number, string>;
  setAnswerKey: (key: Record<number, string>) => void;
  onNext: () => void;
  onBack: () => void;
}

export function AnswerKeyView({
  questionsCount,
  setQuestionsCount,
  columnsCount,
  setColumnsCount,
  optionsCount,
  setOptionsCount,
  answerKey,
  setAnswerKey,
  onNext,
  onBack
}: Props) {
  // 1. مصفوفة الحروف العربية بالترتيب الأبجدي للامتحانات
  const arabicLetters = ['أ', 'ب', 'ج', 'د', 'هـ'];

  // 2. توليد الاختيارات بناءً على المصفوفة العربية
  const options = Array.from({ length: optionsCount }).map((_, idx) => arabicLetters[idx]);

  const handleOptionClick = (q: number, opt: string) => {
    setAnswerKey({
      ...answerKey,
      [q]: answerKey[q] === opt ? '' : opt // toggle
    });
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50 rounded-xl border border-slate-200 shadow-sm p-3 gap-3">
      {/* Answer Key Preset Manager Toolbar */}
      <AnswerKeyTemplateManager
        questionsCount={questionsCount}
        setQuestionsCount={setQuestionsCount}
        columnsCount={columnsCount}
        setColumnsCount={setColumnsCount}
        optionsCount={optionsCount}
        setOptionsCount={setOptionsCount}
        answerKey={answerKey}
        setAnswerKey={setAnswerKey}
      />

      <div className="bg-white rounded-lg border border-slate-200 flex flex-col flex-1 overflow-hidden shadow-xs">
        {/* Manual Fine Tuning Sub-header */}
        <div className="p-3 border-b border-slate-100 bg-slate-50 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-bold text-slate-700 tracking-wide">إدخال الإجابات النموذجية ومواصفات ورقة الإجابة</h2>
            <span className="text-[10px] bg-indigo-50 text-indigo-600 font-bold px-2 py-0.5 rounded border border-indigo-100">
              إجمالي {questionsCount} سؤال
            </span>
          </div>
          
          <div className="flex items-center gap-4 text-xs font-medium text-slate-600">
            <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600">
              عدد الأسئلة:
              <input 
                type="number" 
                min={1} 
                max={200}
                className="border border-slate-300 rounded px-2 py-0.5 w-16 text-slate-900 font-sans text-center bg-white"
                value={questionsCount}
                onChange={(e) => setQuestionsCount(parseInt(e.target.value) || 1)}
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600">
              عدد الأعمدة:
              <input 
                type="number" 
                min={1} 
                max={10}
                className="border border-slate-300 rounded px-2 py-0.5 w-16 text-slate-900 font-sans text-center bg-white"
                value={columnsCount}
                onChange={(e) => setColumnsCount(parseInt(e.target.value) || 1)}
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600">
              عدد الاختيارات:
              <select 
                className="border border-slate-300 rounded px-2 py-0.5 w-24 text-slate-900 font-sans bg-white"
                value={optionsCount}
                onChange={(e) => {
                  setOptionsCount(parseInt(e.target.value));
                  setAnswerKey({}); // reset key when options change
                }}
              >
                <option value={3}>3 (أ - ج)</option>
                <option value={4}>4 (أ - د)</option>
                <option value={5}>5 (أ - هـ)</option>
              </select>
            </label>
          </div>
        </div>

        {/* Question Key Grid */}
        <div className="flex-1 p-4 overflow-y-auto min-h-0 bg-white">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-6 gap-y-2.5">
            {Array.from({ length: questionsCount }).map((_, i) => {
              const qNum = i + 1;
              return (
                <div key={qNum} className="flex items-center justify-between text-xs border border-slate-100 rounded-lg p-2 bg-slate-50/50 hover:bg-slate-50 transition-colors">
                  <span className="font-mono text-xs font-bold text-slate-500">{qNum.toString().padStart(2, '0')}</span>
                  <div className="flex gap-1">
                    {options.map(opt => {
                      const isSelected = answerKey[qNum] === opt;
                      return (
                        <button
                          key={opt}
                          onClick={() => handleOptionClick(qNum, opt)}
                          className={`w-6 h-6 rounded-full border flex items-center justify-center text-xs font-bold transition-all cursor-pointer ${
                            isSelected 
                              ? 'border-indigo-600 bg-indigo-600 text-white shadow-xs scale-105' 
                              : 'border-slate-300 bg-white text-slate-600 hover:border-indigo-400 hover:text-indigo-600'
                          }`}
                        >
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer Navigation Buttons */}
        <div className="p-3 border-t border-slate-100 bg-slate-50 flex justify-between items-center shrink-0">
          <button 
            onClick={onBack}
            className="px-5 py-2 text-xs font-bold bg-white border border-slate-300 rounded-lg hover:bg-slate-100 text-slate-700 transition-colors shadow-xs cursor-pointer"
          >
            السابق (المعايرة)
          </button>
          <button 
            onClick={onNext}
            className="px-6 py-2 text-xs font-bold bg-indigo-600 border border-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors shadow-sm cursor-pointer"
          >
            تأكيد والبدء بالتصحيح
          </button>
        </div>
      </div>
    </div>
  );
}

