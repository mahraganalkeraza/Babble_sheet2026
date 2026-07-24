import React, { useState, useEffect, useRef } from 'react';
import { AnswerKeyPreset } from '../types.ts';
import { 
  Bookmark, 
  Plus, 
  Trash2, 
  Download, 
  Upload, 
  Check, 
  X, 
  FileText, 
  Sparkles,
  Layers,
  HelpCircle
} from 'lucide-react';

const STORAGE_KEY = 'omr_answer_keys';

// Initial default models if localStorage is empty
const DEFAULT_PRESETS: AnswerKeyPreset[] = [
  {
    id: 'preset_sec_1',
    title: '1 نموذج إجابة - ثانوي',
    stage: 'ثانوي',
    questionsCount: 50,
    optionsCount: 4,
    columnsCount: 2,
    correctAnswers: {
      1: 'أ', 2: 'ب', 3: 'ج', 4: 'د', 5: 'أ',
      6: 'ب', 7: 'ج', 8: 'د', 9: 'أ', 10: 'ب',
      11: 'ج', 12: 'د', 13: 'أ', 14: 'ب', 15: 'ج',
      16: 'د', 17: 'أ', 18: 'ب', 19: 'ج', 20: 'د',
      21: 'أ', 22: 'ب', 23: 'ج', 24: 'د', 25: 'أ',
      26: 'ب', 27: 'ج', 28: 'د', 29: 'أ', 30: 'ب',
      31: 'ج', 32: 'د', 33: 'أ', 34: 'ب', 35: 'ج',
      36: 'د', 37: 'أ', 38: 'ب', 39: 'ج', 40: 'د',
      41: 'أ', 42: 'ب', 43: 'ج', 44: 'د', 45: 'أ',
      46: 'ب', 47: 'ج', 48: 'د', 49: 'أ', 50: 'ب'
    },
    createdAt: new Date().toISOString()
  },
  {
    id: 'preset_sec_2',
    title: '2 نموذج إجابة - ثانوي',
    stage: 'ثانوي',
    questionsCount: 40,
    optionsCount: 4,
    columnsCount: 2,
    correctAnswers: {
      1: 'أ', 2: 'أ', 3: 'ب', 4: 'ب', 5: 'ج',
      6: 'ج', 7: 'د', 8: 'د', 9: 'أ', 10: 'ب',
      11: 'ج', 12: 'د', 13: 'أ', 14: 'ب', 15: 'ج',
      16: 'د', 17: 'أ', 18: 'ب', 19: 'ج', 20: 'د',
      21: 'أ', 22: 'ب', 23: 'ج', 24: 'د', 25: 'أ',
      26: 'ب', 27: 'ج', 28: 'د', 29: 'أ', 30: 'ب',
      31: 'ج', 32: 'د', 33: 'أ', 34: 'ب', 35: 'ج',
      36: 'د', 37: 'أ', 38: 'ب', 39: 'ج', 40: 'د'
    },
    createdAt: new Date().toISOString()
  },
  {
    id: 'preset_prep_3',
    title: '3 نموذج إجابة - إعدادي',
    stage: 'إعدادي',
    questionsCount: 30,
    optionsCount: 4,
    columnsCount: 1,
    correctAnswers: {
      1: 'أ', 2: 'ب', 3: 'ج', 4: 'د', 5: 'أ',
      6: 'ب', 7: 'ج', 8: 'د', 9: 'أ', 10: 'ب',
      11: 'ج', 12: 'د', 13: 'أ', 14: 'ب', 15: 'ج',
      16: 'د', 17: 'أ', 18: 'ب', 19: 'ج', 20: 'د',
      21: 'أ', 22: 'ب', 23: 'ج', 24: 'د', 25: 'أ',
      26: 'ب', 27: 'ج', 28: 'د', 29: 'أ', 30: 'ب'
    },
    createdAt: new Date().toISOString()
  }
];

interface AnswerKeyTemplateManagerProps {
  questionsCount: number;
  setQuestionsCount: (n: number) => void;
  columnsCount: number;
  setColumnsCount: (n: number) => void;
  optionsCount: number;
  setOptionsCount: (n: number) => void;
  answerKey: Record<number, string>;
  setAnswerKey: (key: Record<number, string>) => void;
}

export function AnswerKeyTemplateManager({
  questionsCount,
  setQuestionsCount,
  columnsCount,
  setColumnsCount,
  optionsCount,
  setOptionsCount,
  answerKey,
  setAnswerKey
}: AnswerKeyTemplateManagerProps) {
  const [presets, setPresets] = useState<AnswerKeyPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string>('');
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newStage, setNewStage] = useState('ثانوي');
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load presets on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setPresets(parsed);
          setSelectedPresetId(parsed[0].id);
          applyPreset(parsed[0]);
          return;
        }
      }
    } catch (e) {
      console.warn('Failed to load answer keys from localStorage', e);
    }

    // Fallback to default presets
    setPresets(DEFAULT_PRESETS);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_PRESETS));
    } catch (e) {
      console.warn('Could not save initial presets', e);
    }
    if (DEFAULT_PRESETS.length > 0) {
      setSelectedPresetId(DEFAULT_PRESETS[0].id);
      applyPreset(DEFAULT_PRESETS[0]);
    }
  }, []);

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => {
      setNotification(null);
    }, 3000);
  };

  const applyPreset = (preset: AnswerKeyPreset) => {
    setQuestionsCount(preset.questionsCount);
    setColumnsCount(preset.columnsCount);
    setOptionsCount(preset.optionsCount);
    setAnswerKey(preset.correctAnswers || {});
  };

  const handleSelectPreset = (id: string) => {
    setSelectedPresetId(id);
    const found = presets.find((p) => p.id === id);
    if (found) {
      applyPreset(found);
      showNotification(`تم تحميل النموذج: ${found.title}`);
    }
  };

  const handleOpenSaveModal = () => {
    setNewTitle(`نموذج إجابة جديد ${presets.length + 1}`);
    setNewStage('ثانوي');
    setIsSaveModalOpen(true);
  };

  const handleSaveNewPreset = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) {
      showNotification('يرجى إدخال اسم النموذج', 'error');
      return;
    }

    const newPreset: AnswerKeyPreset = {
      id: `model_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      title: newTitle.trim(),
      stage: newStage.trim() || 'عام',
      questionsCount,
      optionsCount,
      columnsCount,
      correctAnswers: { ...answerKey },
      createdAt: new Date().toISOString()
    };

    const updatedPresets = [...presets, newPreset];
    setPresets(updatedPresets);
    setSelectedPresetId(newPreset.id);

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedPresets));
      showNotification(`تم حفظ النموذج بنجاح: ${newPreset.title}`);
    } catch (err) {
      showNotification('حدث خطأ أثناء حفظ النموذج في التخزين المحلي', 'error');
    }

    setIsSaveModalOpen(false);
  };

  const handleDeletePreset = () => {
    if (!selectedPresetId) return;
    const activePreset = presets.find((p) => p.id === selectedPresetId);
    if (!activePreset) return;

    if (!window.confirm(`هل أنت تأكد من حذف نموذج الإجابة "${activePreset.title}"؟`)) {
      return;
    }

    const updatedPresets = presets.filter((p) => p.id !== selectedPresetId);
    setPresets(updatedPresets);

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedPresets));
      showNotification(`تم حذف النموذج: ${activePreset.title}`);
    } catch (err) {
      showNotification('تعذر تحديث التخزين المحلي', 'error');
    }

    if (updatedPresets.length > 0) {
      setSelectedPresetId(updatedPresets[0].id);
      applyPreset(updatedPresets[0]);
    } else {
      setSelectedPresetId('');
      setQuestionsCount(40);
      setColumnsCount(2);
      setOptionsCount(4);
      setAnswerKey({});
    }
  };

  const handleExportJSON = () => {
    try {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(presets, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", `omr_answer_keys_${new Date().toISOString().slice(0,10)}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      showNotification('تم تصدير نماذج الإجابة بنجاح');
    } catch (e) {
      showNotification('فشل تصدير البيانات', 'error');
    }
  };

  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const imported = JSON.parse(content);

        if (!Array.isArray(imported)) {
          showNotification('تنسيق ملف JSON غير صالح (يجب أن يكون قائمة نماذج)', 'error');
          return;
        }

        // Validate basic fields of each preset
        const validPresets: AnswerKeyPreset[] = imported.filter(
          (p) => p && typeof p.id === 'string' && typeof p.title === 'string' && typeof p.questionsCount === 'number'
        );

        if (validPresets.length === 0) {
          showNotification('لم يتم العثور على نماذج إجابة صالحة في الملف', 'error');
          return;
        }

        // Merge with existing, replacing duplicates by ID
        const existingMap = new Map(presets.map((p) => [p.id, p]));
        validPresets.forEach((p) => existingMap.set(p.id, p));
        const merged = Array.from(existingMap.values());

        setPresets(merged);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
        setSelectedPresetId(validPresets[0].id);
        applyPreset(validPresets[0]);

        showNotification(`تم إستيراد ${validPresets.length} نموذج بنجاح`);
      } catch (err) {
        showNotification('خطأ في قراءة ملف JSON', 'error');
      }
    };
    reader.readAsText(file);
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const activePreset = presets.find((p) => p.id === selectedPresetId);

  return (
    <div className="bg-slate-900 text-white p-3 rounded-lg border border-slate-800 shadow-md mb-4 text-right" dir="rtl">
      {/* Toast Notification */}
      {notification && (
        <div className={`mb-3 p-2.5 rounded text-xs font-semibold flex items-center justify-between transition-all ${
          notification.type === 'success' ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/50' : 'bg-rose-950/80 text-rose-300 border border-rose-800/50'
        }`}>
          <div className="flex items-center gap-2">
            {notification.type === 'success' ? <Check className="w-4 h-4 text-emerald-400" /> : <X className="w-4 h-4 text-rose-400" />}
            <span>{notification.message}</span>
          </div>
        </div>
      )}

      {/* Main Toolbar Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Right Section: Dropdown Selector */}
        <div className="flex items-center gap-3 flex-1 min-w-[280px]">
          <div className="flex items-center gap-1.5 text-indigo-400 font-bold text-xs shrink-0">
            <Bookmark className="w-4 h-4" />
            <span>اختر نموذج الإجابة:</span>
          </div>

          <div className="relative flex-1 max-w-md">
            <select
              value={selectedPresetId}
              onChange={(e) => handleSelectPreset(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-md py-1.5 px-3 text-xs font-medium text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all cursor-pointer"
            >
              <option value="" disabled>-- اختر نموذج الإجابة --</option>
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.title} {preset.stage ? `(${preset.stage})` : ''} - {preset.questionsCount} سؤال
                </option>
              ))}
            </select>
          </div>

          {activePreset && (
            <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 bg-slate-800/80 rounded border border-slate-700/60 text-[11px] text-slate-300">
              <span className="font-semibold text-indigo-300">{activePreset.stage || 'عام'}</span>
              <span className="text-slate-500">•</span>
              <span>{activePreset.questionsCount} سؤال</span>
              <span className="text-slate-500">•</span>
              <span>{activePreset.columnsCount} عمود</span>
            </div>
          )}
        </div>

        {/* Left Section: Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleOpenSaveModal}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-md shadow-sm transition-colors cursor-pointer"
            title="حفظ التكوين الحالي كنموذج إجابة جديد"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>حفظ كنموذج إجابة جديد</span>
          </button>

          <button
            onClick={handleDeletePreset}
            disabled={!selectedPresetId} 
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-rose-900/40 text-rose-400 hover:text-rose-300 border border-slate-700 hover:border-rose-800 text-xs font-bold rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            title="حذف النموذج المحدد"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>حذف النموذج</span>
          </button>

          <div className="h-4 w-px bg-slate-700 mx-1 hidden md:block"></div>

          <button
            onClick={handleExportJSON}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-medium rounded-md transition-colors cursor-pointer"
            title="تصدير جميع النماذج لملف JSON"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">تصدير JSON</span>
          </button>

          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-medium rounded-md transition-colors cursor-pointer"
            title="إستيراد نماذج إجابة من ملف JSON"
          >
            <Upload className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">إستيراد JSON</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleImportJSON}
            className="hidden"
          />
        </div>
      </div>

      {/* Save Modal Dialog */}
      {isSaveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs">
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-md w-full p-5 shadow-2xl text-right animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2 text-indigo-400 font-bold text-sm">
                <Sparkles className="w-4 h-4" />
                <span>حفظ نموذج إجابة جديد</span>
              </div>
              <button
                onClick={() => setIsSaveModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveNewPreset} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5">
                  اسم نموذج الإجابة <span className="text-indigo-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="مثال: نموذج إجابة - ثانوي 1"
                  className="w-full bg-slate-800 border border-slate-700 rounded-md py-2 px-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5">
                  المرحلة الدراسية
                </label>
                <select
                  value={newStage}
                  onChange={(e) => setNewStage(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-md py-2 px-3 text-xs text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                >
                  <option value="ثانوي">المرحلة الثانوية</option>
                  <option value="إعدادي">المرحلة الإعدادية</option>
                  <option value="ابتدائي">المرحلة الابتدائية</option>
                  <option value="جامعي">المرحلة الجامعية / عام</option>
                  <option value="خاص">نموذج خاص</option>
                </select>
              </div>

              {/* Current Configuration Summary Box */}
              <div className="bg-slate-850 p-3 rounded-lg border border-slate-800 text-xs space-y-1.5">
                <div className="font-bold text-slate-300 text-[11px] flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-indigo-400" />
                  <span>معايير الورقة الحالية المحفوظة:</span>
                </div>
                <div className="grid grid-cols-3 gap-2 pt-1 text-[11px] text-slate-400 font-mono">
                  <div className="bg-slate-800 p-1.5 rounded text-center">
                    <span className="block text-[10px] text-slate-500">الأسئلة</span>
                    <span className="font-bold text-white">{questionsCount}</span>
                  </div>
                  <div className="bg-slate-800 p-1.5 rounded text-center">
                    <span className="block text-[10px] text-slate-500">الأعمدة</span>
                    <span className="font-bold text-white">{columnsCount}</span>
                  </div>
                  <div className="bg-slate-800 p-1.5 rounded text-center">
                    <span className="block text-[10px] text-slate-500">الاختيارات</span>
                    <span className="font-bold text-white">{optionsCount}</span>
                  </div>
                </div>
                <div className="text-[10px] text-emerald-400 text-center pt-1">
                  سيتم حفظ {Object.keys(answerKey).filter(k => answerKey[Number(k)]).length} إجابة نموذجية محددة حالياً
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsSaveModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-md transition-colors"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-md shadow-sm transition-colors flex items-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>حفظ النموذج</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
