import React, { useState, useEffect, useRef } from 'react';
import * as xlsx from 'xlsx';
import { StudentResult } from '../types.ts';
import { DownloadCloud, CheckCircle2, XCircle, AlertCircle, Undo, Database } from 'lucide-react';
import { getSupabase } from '../lib/supabase.ts';

interface Props {
  results: StudentResult[];
  setResults: React.Dispatch<React.SetStateAction<StudentResult[]>>;
  onRestart: () => void;
  questionsCount?: number;
}

export function ResultsView({ results, setResults, onRestart, questionsCount = 50 }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ id: string; score: number }>({ id: '', score: 0 });
  const [history, setHistory] = useState<StudentResult[][]>([]);
  const [filter, setFilter] = useState<'all' | 'success' | 'needs_review'>('all');
  
  const [loadingIds, setLoadingIds] = useState<Record<string, boolean>>({});
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  const attemptedIds = useRef<Set<string>>(new Set());

  // Local CSV database lookup state
  const [localDb, setLocalDb] = useState<Record<string, { name: string; church: string; level: string }>>(() => {
    try {
      const saved = localStorage.getItem('omr_student_db');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.warn('Failed to load local student db', e);
    }
    return {};
  });

  // Sync results with local lookup DB immediately when results or localDb change
  useEffect(() => {
    let updated = false;
    const newResults = results.map(res => {
      const id = res.id;
      if (id && localDb[id]) {
        const localStudent = localDb[id];
        if (res.name !== localStudent.name || res.church !== localStudent.church || res.level !== localStudent.level) {
          updated = true;
          return {
            ...res,
            name: localStudent.name || '—',
            church: localStudent.church || '—',
            level: localStudent.level || '—'
          };
        }
      }
      return res;
    });
    if (updated) {
      setResults(newResults);
    }
  }, [localDb, results, setResults]);

  // Robust Excel Parser and Importer
  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];

    // Soft alert/warning if name check doesn't match registrations.xlsx
    const fileNameLower = file.name.toLowerCase();
    if (fileNameLower !== 'registrations.xlsx' && fileNameLower !== 'registrations.xls') {
      const confirmProceed = window.confirm(
        `تنبيه: يتوقع النظام ملفاً باسم "registrations.xlsx" لمطابقة كود الطالب والبيانات بنجاح.\nالملف المرفوع حالياً هو "${file.name}".\n\nهل تريد الاستمرار على أي حال؟`
      );
      if (!confirmProceed) {
        e.target.value = '';
        return;
      }
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const ab = event.target?.result as ArrayBuffer;
        if (!ab) return;

        const workbook = xlsx.read(ab, { type: 'array' });
        if (workbook.SheetNames.length === 0) {
          alert('ملف Excel غير صالح أو فارغ.');
          return;
        }

        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = xlsx.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

        if (jsonData.length === 0) {
          alert('ورقة العمل الأولى فارغة.');
          return;
        }

        // Search headers dynamically (Arabic or English)
        const headers = jsonData[0].map(h => String(h || '').trim());
        
        const idIdx = headers.findIndex(h => h === 'student_id' || h === 'كود الطالب');
        const nameIdx = headers.findIndex(h => h === 'name' || h === 'الاسم');
        const churchIdx = headers.findIndex(h => h === 'churchName' || h === 'اسم الكنيسة');
        const stageIdx = headers.findIndex(h => h === 'stage' || h === 'المرحلة');

        const missingFields: string[] = [];
        if (idIdx === -1) missingFields.push('student_id أو كود الطالب');
        if (nameIdx === -1) missingFields.push('name أو الاسم');
        if (churchIdx === -1) missingFields.push('churchName أو اسم الكنيسة');
        if (stageIdx === -1) missingFields.push('stage أو المرحلة');

        if (missingFields.length > 0) {
          alert(`ملف الـ Excel المرفوع لا يحتوي على رؤوس الأعمدة المطلوبة:\n${missingFields.join('\n')}\n\nيرجى التأكد من تسمية رؤوس الأعمدة بشكل صحيح (مثل student_id أو كود الطالب، name أو الاسم، إلخ).`);
          return;
        }

        const studentLookupMap: Record<string, { name: string; church: string; level: string }> = {};
        
        jsonData.slice(1).forEach(row => {
          const studentId = row[idIdx];
          if (studentId !== undefined && studentId !== null && String(studentId).trim() !== '') {
            const idStr = String(studentId).trim();
            studentLookupMap[idStr] = {
              name: String(row[nameIdx] || '').trim() || '—',
              church: String(row[churchIdx] || '').trim() || '—',
              level: String(row[stageIdx] || '').trim() || '—'
            };
          }
        });

        setLocalDb(studentLookupMap);
        
        try {
          localStorage.setItem('omr_student_db', JSON.stringify(studentLookupMap));
        } catch (storageError) {
          console.warn('Failed to save large registrations database to localStorage, keeping in-memory only.', storageError);
        }

        // Reset attempted IDs to trigger re-lookup for existing results that had missing profiles
        attemptedIds.current.clear();

        alert(`تم استيراد قاعدة بيانات الطلاب من Excel بنجاح! تم العثور على ${Object.keys(studentLookupMap).length} طالب.`);
      } catch (err) {
        console.error('Failed to parse Excel', err);
        alert('حدث خطأ أثناء قراءة ملف الـ Excel. يرجى التأكد من صياغة الملف.');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // Automatic profile fetch when a valid ID is present and its profile hasn't been loaded yet
  useEffect(() => {
    results.forEach(res => {
      const id = res.id;
      if (!id || id === 'ID_Unknown' || id === 'كود غير مسجل' || id.trim() === '') return;
      if (attemptedIds.current.has(id)) return;
      if (loadingIds[id]) return;

      // If already has profile, mark as attempted and skip
      if (res.name && res.name !== 'كود غير مسجل' && res.name !== 'خطأ في الاتصال' && res.church && res.level) {
        attemptedIds.current.add(id);
        return;
      }

      // Check Local Lookup first
      if (localDb[id]) {
        attemptedIds.current.add(id);
        const localStudent = localDb[id];
        setResults((prevResults: StudentResult[]) => prevResults.map(r => 
          r.id === id 
            ? { 
                ...r, 
                name: localStudent.name || '—', 
                church: localStudent.church || '—', 
                level: localStudent.level || '—' 
              }
            : r
        ));
        return;
      }

      // Otherwise fall back to Supabase
      const supabase = getSupabase();
      if (!supabase) {
        const url = (import.meta as any).env.VITE_SUPABASE_URL;
        const key = (import.meta as any).env.VITE_SUPABASE_ANON_KEY;
        if (!url || !key) {
          // If we have local database, don't show warnings for missing Supabase config
          if (Object.keys(localDb).length === 0) {
            setWarningMessage("تنبيه: إعدادات اتصال Supabase غير متوفرة! يرجى إضافة VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY لتفعيل جلب بيانات الطلاب تلقائياً أو ارفع قاعدة البيانات محلياً عبر زر Excel واستيراد ملف registrations.xlsx.");
          }
        }
        return;
      }

      // Mark as loading and attempted
      attemptedIds.current.add(id);
      setLoadingIds(prev => ({ ...prev, [id]: true }));

      (async () => {
        try {
          const tableCandidates = ['registrations', 'registration', 'students', 'student'];
          let matchedData: any = null;
          let fetchError: any = null;

          for (const tableName of tableCandidates) {
            try {
              // Try querying the specific requested columns first
              const { data, error } = await supabase
                .from(tableName)
                .select('name, churchName, stage')
                .eq('student_id', id);

              if (!error && data && data.length > 0) {
                const firstRow = data[0] as any;
                matchedData = {
                  name: firstRow.name,
                  churchName: firstRow.churchName,
                  stage: firstRow.stage
                };
                break;
              }

              // If it failed due to schema/table path invalidity, try next table
              if (error && (error.code === 'PGRST125' || error.message?.includes('relation') || error.message?.includes('does not exist') || error.message?.includes('Invalid path'))) {
                fetchError = error;
                continue;
              }

              // Fallback: If table exists but columns fail, try selecting * to map dynamically
              const { data: wildcardData, error: wildcardError } = await supabase
                .from(tableName)
                .select('*')
                .eq('student_id', id);

              if (!wildcardError && wildcardData && wildcardData.length > 0) {
                const row = wildcardData[0] as any;
                matchedData = {
                  name: row.name || row.student_name || row.full_name || row.fullname || '—',
                  churchName: row.churchName || row.church || row.church_name || '—',
                  stage: row.stage || row.level || row.grade || row.class || '—'
                };
                break;
              }

              if (error || wildcardError) {
                fetchError = error || wildcardError;
              }
            } catch (innerErr: any) {
              fetchError = innerErr;
            }
          }

          if (matchedData) {
            setResults((prevResults: StudentResult[]) => prevResults.map(r => 
              r.id === id 
                ? { 
                    ...r, 
                    name: matchedData.name || '—', 
                    church: matchedData.churchName || '—', 
                    level: matchedData.stage || '—' 
                  }
                : r
            ));
          } else {
            setWarningMessage(`تنبيه: الطالب ذو الكود (${id}) غير مسجل في قاعدة البيانات!`);
            setResults((prevResults: StudentResult[]) => prevResults.map(r => 
              r.id === id 
                ? { 
                    ...r, 
                    name: 'كود غير مسجل', 
                    church: 'N/A', 
                    level: 'N/A' 
                  }
                : r
            ));
          }
        } catch (err: any) {
          console.warn(`Warning querying student ID ${id}:`, err);
          setResults((prevResults: StudentResult[]) => prevResults.map(r => 
            r.id === id 
              ? { 
                  ...r, 
                  name: 'كود غير مسجل', 
                  church: 'N/A', 
                  level: 'N/A' 
                }
              : r
          ));
        } finally {
          setLoadingIds(prev => {
            const copy = { ...prev };
            delete copy[id];
            return copy;
          });
        }
      })();
    });
  }, [results, setResults, localDb]);

  const exportExcel = () => {
    const passingScore = questionsCount / 2;
    const data = results.map(r => ({
      'Student ID': String(r.id),
      'Name': r.name,
      'Church': r.church,
      'Level': r.level || 'N/A',
      'Score': r.score !== undefined ? r.score : 0,
      'Status': r.status !== 'success' ? 'تم التصحيح' : (r.score >= passingScore ? 'ناجح' : 'لم يجتز'),
    }));
    const sheet = xlsx.utils.json_to_sheet(data);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, sheet, 'Results');
    xlsx.writeFile(workbook, `OMR_Results_${new Date().getTime()}.xlsx`);
  };

  const startEdit = (result: StudentResult) => {
    setEditingId(result.id);
    setEditForm({ id: result.id, score: result.score });
  };

  const saveEdit = (oldId: string) => {
    setHistory([...history, results]);
    if (editForm.id !== oldId) {
      attemptedIds.current.delete(editForm.id);
    }
    setResults(results.map(r => 
      r.id === oldId 
        ? { 
            ...r, 
            id: editForm.id, 
            score: editForm.score, 
            name: '', 
            church: '', 
            level: '', 
            status: 'success' 
          }
        : r
    ));
    setEditingId(null);
  };

  const undo = () => {
    if (history.length > 0) {
      const prev = history[history.length - 1];
      setHistory(history.slice(0, -1));
      setResults(prev);
    }
  };

  const filteredResults = results.filter(res => {
    if (filter === 'all') return true;
    if (filter === 'success') return res.status === 'success';
    if (filter === 'needs_review') return res.status !== 'success';
    return true;
  });

  return (
    <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-full min-h-0">
      <div className="p-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <h2 className="text-xs font-bold uppercase text-slate-500 tracking-wider">Live Results Feed <span className="text-slate-400 font-normal ml-2 tracking-normal lowercase">({results.length} processed)</span></h2>
          <div className="flex items-center gap-2 border-l border-slate-200 pl-4">
            <span className="text-[10px] font-bold uppercase text-slate-400">Filter:</span>
            <select
              value={filter}
              onChange={e => setFilter(e.target.value as 'all' | 'success' | 'needs_review')}
              className="px-2 py-0.5 text-xs font-medium border border-slate-200 rounded text-slate-600 bg-white"
            >
              <option value="all">All</option>
              <option value="success">Success</option>
              <option value="needs_review">Needs Review</option>
            </select>
          </div>
        </div>
        <div className="flex gap-2">
          <input 
            id="excel-db-upload" 
            type="file" 
            accept=".xlsx, .xls" 
            className="hidden" 
            onChange={handleExcelUpload} 
          />
          <button 
            onClick={() => document.getElementById('excel-db-upload')?.click()}
            className="px-4 py-1.5 text-[10px] uppercase tracking-wide font-bold bg-amber-500 border border-amber-500 hover:bg-amber-600 text-white rounded flex items-center gap-1 transition-colors cursor-pointer"
          >
            <Database className="w-3 h-3" /> Import Excel DB (registrations.xlsx)
          </button>
          <button 
            onClick={undo}
            disabled={history.length === 0}
            className={`px-4 py-1.5 text-[10px] uppercase tracking-wide font-bold border rounded flex items-center gap-1 ${history.length === 0 ? 'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed' : 'bg-white border-slate-300 hover:bg-slate-50 text-slate-600'}`}
          >
            <Undo className="w-3 h-3" /> Undo
          </button>
          <button 
            onClick={onRestart}
            className="px-4 py-1.5 text-[10px] uppercase tracking-wide font-bold bg-white border border-slate-300 rounded hover:bg-slate-50 text-slate-600"
          >
            Process Another PDF
          </button>
          <button 
            onClick={exportExcel}
            className="px-4 py-1.5 text-[10px] uppercase tracking-wide font-bold bg-indigo-600 border border-indigo-600 text-white rounded flex items-center gap-1 hover:bg-indigo-700"
          >
            <DownloadCloud className="w-3 h-3" /> Export Excel
          </button>
        </div>
      </div>
      
      {Object.keys(localDb).length === 0 ? (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 flex items-center gap-2 text-xs text-amber-800 font-medium shrink-0">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>برجاء رفع ملف بيانات المشتركين المسمى <strong className="font-bold underline">registrations.xlsx</strong> لتفعيل جلب الأسماء وتطابق بيانات الطلاب تلقائياً.</span>
        </div>
      ) : (
        <div className="bg-emerald-50 border-b border-emerald-200 px-4 py-2.5 flex items-center gap-2 text-xs text-emerald-800 font-medium shrink-0">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>تم تحميل قاعدة بيانات الطلاب بنجاح: تم تسجيل <strong className="font-bold">{Object.keys(localDb).length.toLocaleString()}</strong> مشترك من ملف <strong className="font-bold">registrations.xlsx</strong>.</span>
        </div>
      )}
      
      {warningMessage && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 flex items-center justify-between text-xs text-amber-800 font-medium shrink-0">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>{warningMessage}</span>
          </div>
          <button 
            onClick={() => setWarningMessage(null)}
            className="text-amber-500 hover:text-amber-700 font-bold px-2 py-0.5 rounded hover:bg-amber-100 transition-colors cursor-pointer"
          >
            إغلاق
          </button>
        </div>
      )}
      
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-left">
          <thead className="sticky top-0 bg-white shadow-sm z-10">
            <tr className="text-[10px] uppercase text-slate-400 font-bold border-b border-slate-100">
              <th className="p-3">Status</th>
              <th className="p-3">Student ID</th>
              <th className="p-3 text-right">Name</th>
              <th className="p-3 text-right">Church</th>
              <th className="p-3">Level</th>
              <th className="p-3">Score</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="text-xs divide-y divide-slate-50">
            {filteredResults.map((res, i) => (
              <tr key={i} className={`hover:bg-slate-50 transition-colors ${res.status.startsWith('failed') ? 'bg-red-50/30 hover:bg-red-50' : ''}`}>
                <td className="p-3">
                  {res.status === 'success' && <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-[9px] font-bold uppercase">SUCCESS</span>}
                  {res.status === 'failed_qr' && <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-[9px] font-bold uppercase">QR_FAIL</span>}
                  {res.status === 'failed_omr' && <span className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full text-[9px] font-bold uppercase">OMR_FAIL</span>}
                  {res.status === 'needs_review' && <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-[9px] font-bold uppercase">REVIEW</span>}
                </td>
                <td className={`p-3 font-mono ${res.status === 'failed_qr' ? 'text-red-600 italic' : 'text-indigo-600'}`}>
                  {editingId === res.id ? (
                    <input 
                      type="text" 
                      className="border border-indigo-300 rounded px-2 py-1 w-24 font-sans text-slate-900 bg-white focus:outline-none"
                      value={editForm.id}
                      onChange={e => setEditForm({ ...editForm, id: e.target.value })}
                    />
                  ) : (
                    res.id
                  )}
                </td>
                <td dir="rtl" className={`p-3 text-right font-medium ${!res.name ? 'text-slate-400' : 'text-slate-800'}`}>
                  {loadingIds[res.id] ? (
                    <div className="h-4 bg-slate-200 rounded animate-pulse w-28 inline-block"></div>
                  ) : (
                    res.name || '—'
                  )}
                </td>
                <td dir="rtl" className={`p-3 text-right ${!res.church ? 'text-slate-400' : 'text-slate-600'}`}>
                  {loadingIds[res.id] ? (
                    <div className="h-4 bg-slate-100 rounded animate-pulse w-24 inline-block"></div>
                  ) : (
                    res.church || '—'
                  )}
                </td>
                <td className={`p-3 ${!res.level ? 'text-slate-400' : 'text-slate-600'}`}>
                  {loadingIds[res.id] ? (
                    <div className="h-4 bg-slate-100 rounded animate-pulse w-16 inline-block"></div>
                  ) : (
                    res.level || '—'
                  )}
                </td>
                <td className="p-3 font-semibold text-slate-900">
                  {editingId === res.id ? (
                    <input 
                      type="number" 
                      className="border border-indigo-300 rounded px-2 py-1 w-16 font-sans text-slate-900 bg-white focus:outline-none"
                      value={editForm.score}
                      onChange={e => setEditForm({ ...editForm, score: parseInt(e.target.value) || 0 })}
                    />
                  ) : (
                    res.score
                  )}
                </td>
                <td className="p-3 text-right">
                  {editingId === res.id ? (
                    <button 
                      onClick={() => saveEdit(res.id)}
                      className="text-indigo-600 hover:text-indigo-800 font-bold text-[10px] uppercase tracking-wider"
                    >
                      Save
                    </button>
                  ) : (
                    <div className="flex justify-end gap-3">
                      {res.pageImage && (
                        <button 
                          onClick={() => {
                            const win = window.open();
                            win?.document.write(`<html><body style="margin:0;background:#0f172a;display:flex;justify-content:center"><img src="${res.pageImage}" style="max-height:100vh;max-width:100%"/></body></html>`);
                          }}
                          className="text-slate-400 hover:text-indigo-600 text-[10px] font-bold uppercase tracking-wider transition-colors"
                        >
                          View Scan
                        </button>
                      )}
                      <button 
                        onClick={() => startEdit(res)}
                        className="text-slate-400 hover:text-indigo-600 font-bold text-[10px] uppercase tracking-wider transition-colors"
                      >
                        Edit
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {filteredResults.length === 0 && (
              <tr>
                <td colSpan={7} className="p-12 text-center text-slate-400 font-medium">
                  No results to display.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
