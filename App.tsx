
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { analyzeImageToStoryboardPlan, generateStoryShot, suggestNarrativeCategories, updatePromptsWithEdits, validateApiKey } from './geminiService';
import { AppState, StoryboardAngle, AppMode, AppStep, StoryboardPlan, ZoomDirection } from './types';

const INITIAL_STATE: AppState = {
  appMode: 'home',
  appStep: 'upload',
  originalImage: null,
  plan: null,
  angles: [],
  isAnalyzing: false,
  analysisProgress: 0,
  isGeneratingAll: false,
  generationMode: 'standard', 
  suggestedCategories: [],
  selectedCategory: null,
  zoomDirection: 'in',
  isTranslated: false,
  isEditing: false
};

const App: React.FC = () => {
  const [state, setState] = useState<AppState>(INITIAL_STATE);
  const [error, setError] = useState<string | null>(null);
  const [keyStatus, setKeyStatus] = useState<'none' | 'saved' | 'checking' | 'valid' | 'invalid'>('none');
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [customCategory, setCustomCategory] = useState("");
  const [apiKey, setApiKey] = useState<string>("");
  const [keyInput, setKeyInput] = useState<string>("");
  const [isKeyModalOpen, setIsKeyModalOpen] = useState(false);
  const [keyMessage, setKeyMessage] = useState<string | null>(null);
  const [proAccess, setProAccess] = useState<boolean>(false);
  
  const checkingRef = useRef(false);

  useEffect(() => {
    const savedKey = localStorage.getItem('gemini_api_key');
    if (savedKey) {
      setApiKey(savedKey);
      setKeyInput(savedKey);
      setKeyStatus('saved');
      setProAccess(false);
    }
  }, []);

  const checkKeyStatus = useCallback(async (forceCheck: boolean = false) => {
    if (checkingRef.current) return false;
    if (!apiKey) {
      setKeyStatus('none');
      return false;
    }
    if (!forceCheck && keyStatus === 'valid') return true;

    checkingRef.current = true;
    try {
      setKeyStatus('checking');
      const { valid, proAvailable } = await validateApiKey(apiKey);
      setKeyStatus(valid ? 'valid' : 'invalid');
      setProAccess(Boolean(proAvailable));
      return valid;
    } catch (err) {
      setKeyStatus('invalid');
      setProAccess(false);
      return false;
    } finally {
      checkingRef.current = false;
    }
  }, [apiKey, keyStatus]);

  useEffect(() => {
    let interval: any;
    if (state.isAnalyzing) {
      interval = setInterval(() => {
        setState(prev => ({
          ...prev,
          analysisProgress: prev.analysisProgress < 95 ? prev.analysisProgress + Math.floor(Math.random() * 5) + 1 : 95
        }));
      }, 300);
    } else clearInterval(interval);
    return () => clearInterval(interval);
  }, [state.isAnalyzing]);

  const handleOpenKeySelector = () => {
    setKeyInput(apiKey);
    setKeyMessage(null);
    setIsKeyModalOpen(true);
  };

  const handleResetKeyInput = () => {
    setKeyInput("");
    setKeyMessage("입력값이 초기화되었습니다.");
  };

  const handleDisconnectKey = () => {
    localStorage.removeItem('gemini_api_key');
    setApiKey("");
    setKeyInput("");
    setKeyStatus('none');
    setKeyMessage("API Key 연결이 해제되었습니다.");
    setError(null);
    setProAccess(false);
  };

  const handleSaveApiKey = async () => {
    const trimmedKey = keyInput.trim();
    if (!trimmedKey) {
      handleDisconnectKey();
      return;
    }

    setApiKey(trimmedKey);
    localStorage.setItem('gemini_api_key', trimmedKey);
    setKeyStatus('checking');
    const { valid, proAvailable } = await validateApiKey(trimmedKey);
    setKeyStatus(valid ? 'valid' : 'invalid');
    setProAccess(Boolean(proAvailable));
    setError(valid ? null : "API Key가 유효하지 않습니다.");
    setKeyMessage(valid ? (proAvailable ? "검증이 완료되었습니다." : "키는 유효하지만 Pro 접근이 없습니다.") : "API Key가 유효하지 않습니다.");
  };

  const ensureValidKey = useCallback(async () => {
    if (!apiKey) {
      setKeyStatus('none');
      setError("API Key를 입력하세요.");
      setIsKeyModalOpen(true);
      return false;
    }
    if (keyStatus === 'valid') return true;
    const isValid = await checkKeyStatus(true);
    if (!isValid) {
      setError("API Key가 유효하지 않습니다.");
      setIsKeyModalOpen(true);
    }
    return isValid;
  }, [apiKey, checkKeyStatus, keyStatus]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const imgData = reader.result as string;
      if (state.appMode === 'whatsNext') {
        setState(prev => ({ ...prev, originalImage: imgData, isAnalyzing: true, analysisProgress: 0 }));
        const canUseKey = await ensureValidKey();
        if (!canUseKey) {
          setState(prev => ({ ...prev, isAnalyzing: false }));
          return;
        }
        try {
          const categories = await suggestNarrativeCategories(imgData, apiKey);
          setState(prev => ({ ...prev, originalImage: imgData, suggestedCategories: categories, appStep: 'modeSetup', isAnalyzing: false }));
        } catch (err: any) {
          if (err.message === 'REQUEST_TIMEOUT') {
            setError("요청 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.");
          }
          setState(prev => ({ ...prev, originalImage: imgData, appStep: 'modeSetup', isAnalyzing: false }));
        }
      } else if (state.appMode === 'zooms') {
        setState(prev => ({ ...prev, originalImage: imgData, appStep: 'modeSetup' }));
      } else {
        setState(prev => ({ ...prev, originalImage: imgData, appStep: 'planning' }));
      }
    };
    reader.readAsDataURL(file);
  };

  const startAnalysis = async () => {
    if (!state.originalImage) return;
    const canUseKey = await ensureValidKey();
    if (!canUseKey) return;
    setState(prev => ({ ...prev, isAnalyzing: true, analysisProgress: 0 }));
    setError(null);
    try {
      const category = state.selectedCategory || customCategory || null;
      const plan = await analyzeImageToStoryboardPlan(state.originalImage, state.appMode, category, state.zoomDirection, apiKey);
      const initialAngles: StoryboardAngle[] = plan.angles.map((a, idx) => ({
        id: idx,
        name: a.name,
        description: '',
        prompt: a.prompt,
        promptKo: a.promptKo,
        status: 'pending'
      }));
      setState(prev => ({ ...prev, plan, angles: initialAngles, isAnalyzing: false, analysisProgress: 100, appStep: 'result' }));
    } catch (err: any) {
      if (err.message === 'REQUEST_TIMEOUT') {
        setError("기획 생성이 지연되고 있습니다. 다시 시도해 주세요.");
      } else {
        setError(err.message || "분석 실패");
      }
      setState(prev => ({ ...prev, isAnalyzing: false }));
    }
  };

  const handleSaveEdits = async () => {
    if (!state.plan) return;
    const canUseKey = await ensureValidKey();
    if (!canUseKey) return;
    setState(prev => ({ ...prev, isAnalyzing: true, isEditing: false }));
    try {
      const newPlan = await updatePromptsWithEdits(state.plan, state.appMode, apiKey);
      const newAngles: StoryboardAngle[] = newPlan.angles.map((a, idx) => ({
        id: idx,
        name: a.name,
        description: '',
        prompt: a.prompt,
        promptKo: a.promptKo,
        status: 'pending'
      }));
      setState(prev => ({ ...prev, plan: newPlan, angles: newAngles, isAnalyzing: false }));
    } catch (err: any) {
      if (err.message === 'REQUEST_TIMEOUT') {
        setError("업데이트 요청이 지연되었습니다. 다시 시도해 주세요.");
      } else {
        setError("업데이트 실패");
      }
      setState(prev => ({ ...prev, isAnalyzing: false }));
    }
  };

  const generateAngleImage = async (id: number) => {
    let isPro = state.generationMode === 'pro';
    
    const canUseKey = await ensureValidKey();
    if (!canUseKey) return;
    if (isPro && !proAccess) {
      setError("Pro 모델 접근 권한이 없어 Standard로 전환합니다.");
      setState(prev => ({ ...prev, generationMode: 'standard' }));
      isPro = false;
    }

    setState(prev => ({ ...prev, angles: prev.angles.map(a => a.id === id ? { ...a, status: 'generating' } : a) }));
    const angle = state.angles.find(a => a.id === id);
    if (!angle || !state.plan || !state.originalImage) return;
    
    try {
      const imageUrl = await generateStoryShot(
        angle.prompt, 
        state.originalImage,
        isPro, 
        {
          aspectRatio: state.plan.aspectRatio,
          resolution: state.plan.resolution
        },
        apiKey
      );
      setState(prev => ({ ...prev, angles: prev.angles.map(a => a.id === id ? { ...a, status: 'completed', imageUrl } : a) }));
    } catch (err: any) {
      if (err.message === 'API_KEY_MISSING') {
        setKeyStatus('none');
        setError("API Key를 입력하세요.");
        setIsKeyModalOpen(true);
      } else if (err.message === 'REQUEST_TIMEOUT') {
        setError("이미지 생성 시간이 초과되었습니다. 다시 시도해 주세요.");
      } else if (err.message === 'API_KEY_INVALID' || err.message?.includes("Requested entity was not found")) {
        setKeyStatus('invalid');
        setError("Pro API Key가 유효하지 않거나 한도를 초과했습니다. 다시 설정하거나 Standard 모드를 사용하세요.");
      } else {
        setError("이미지 생성 중 오류가 발생했습니다.");
      }
      setState(prev => ({ ...prev, angles: prev.angles.map(a => a.id === id ? { ...a, status: 'error' } : a) }));
    }
  };

  const generateAllImages = async () => {
    setState(prev => ({ ...prev, isGeneratingAll: true }));
    for (const angle of state.angles.filter(a => a.status !== 'completed')) {
      await generateAngleImage(angle.id);
    }
    setState(prev => ({ ...prev, isGeneratingAll: false }));
  };

  const handleBack = () => {
    if (state.appStep === 'result') setState(prev => ({ ...prev, appStep: (state.appMode === 'whatsNext' || state.appMode === 'zooms') ? 'modeSetup' : 'upload' }));
    else if (state.appStep === 'modeSetup' || state.appStep === 'planning') setState(prev => ({ ...prev, appStep: 'upload', originalImage: null }));
    else setState(INITIAL_STATE);
  };

  const copyToClipboard = async (text: string, id: number) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const toSafeFilename = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "image";

  const downloadDataUrl = (dataUrl: string, filename: string) => {
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const handleDownloadImage = (angle: StoryboardAngle) => {
    if (!angle.imageUrl) return;
    const safeName = toSafeFilename(angle.name);
    downloadDataUrl(angle.imageUrl, `storyboard_step_${String(angle.id + 1).padStart(2, "0")}_${safeName}.png`);
  };

  const handleDownloadAllImages = () => {
    const available = state.angles.filter((angle) => angle.imageUrl);
    if (!available.length) {
      setError("다운로드할 이미지가 없습니다.");
      return;
    }
    available.forEach((angle, index) => {
      setTimeout(() => handleDownloadImage(angle), index * 200);
    });
  };

  const currentTheme = state.appMode === 'zooms' 
    ? (state.zoomDirection === 'in' ? '시네마틱 확대 (Zoom-in)' : '시네마틱 축소 (Zoom-out)')
    : (state.selectedCategory || customCategory);

  const isConsistencyActive = state.generationMode === 'pro' && keyStatus === 'valid' && proAccess;

  return (
    <div className="min-h-screen pb-12 bg-slate-950 text-slate-100 selection:bg-indigo-500/30 flex flex-col">
      <header className="sticky top-0 z-50 bg-slate-900/80 backdrop-blur-md border-b border-slate-800 px-6 py-4 flex items-center justify-between shadow-2xl">
        <div className="flex items-center gap-3 cursor-pointer group" onClick={() => setState(INITIAL_STATE)}>
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center group-hover:bg-indigo-500 transition-colors">
            <i className="fas fa-clapperboard text-xl text-white"></i>
          </div>
          <div className="flex flex-col">
            <h1 className="text-xl font-bold text-white tracking-tight leading-none">Cinematic <span className="text-indigo-400">Storyboard</span></h1>
            <span className="text-[9px] text-slate-500 font-bold tracking-widest uppercase mt-1">AI Visualization Studio</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={handleOpenKeySelector} 
            className={`text-xs px-4 py-2 rounded-xl border transition-all font-bold flex items-center gap-2 outline-none
              ${keyStatus === 'valid' ? 'border-green-500/50 text-green-400 bg-green-500/10 shadow-[0_0_20px_rgba(34,197,94,0.15)]' : 
                keyStatus === 'invalid' ? 'border-red-500/50 text-red-400 bg-red-500/10 shadow-[0_0_20px_rgba(239,68,68,0.1)]' : 
                keyStatus === 'checking' ? 'border-indigo-500/50 text-indigo-400 bg-indigo-500/10 animate-pulse' :
                keyStatus === 'saved' ? 'border-slate-600/60 text-slate-300 bg-slate-800/40' :
                'border-slate-700/50 text-slate-500 bg-slate-900 shadow-inner hover:border-indigo-500/50 hover:text-indigo-400'}`}
          >
            <i className={`fas ${keyStatus === 'valid' ? 'fa-check-circle' : keyStatus === 'invalid' ? 'fa-exclamation-circle' : keyStatus === 'checking' ? 'fa-circle-notch fa-spin' : keyStatus === 'saved' ? 'fa-key' : 'fa-plus-circle'}`}></i>
            {keyStatus === 'valid' ? (proAccess ? 'API Key Active (Pro)' : 'API Key Active') : 
             keyStatus === 'invalid' ? 'Invalid API Key' : 
             keyStatus === 'checking' ? 'Validating API Key...' : 
             keyStatus === 'saved' ? 'API Key Saved' : 'Set API Key'}
          </button>
          {state.appMode !== 'home' && (
            <button onClick={handleBack} className="text-sm font-bold text-slate-400 hover:text-white bg-slate-800 px-4 py-2 rounded-xl border border-slate-700 flex items-center gap-2">
              <i className="fas fa-chevron-left text-[10px]"></i> Back
            </button>
          )}
        </div>
      </header>

      {isKeyModalOpen && (
        <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center px-6">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-[2rem] p-8 shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-black">API Key 설정</h3>
              <button
                onClick={() => {
                  setIsKeyModalOpen(false);
                  setKeyInput(apiKey);
                }}
                className="text-slate-500 hover:text-white"
              >
                <i className="fas fa-times text-lg"></i>
              </button>
            </div>
            <p className="text-sm text-slate-400 mb-5">
              개인 Gemini API Key를 입력하면 나노바나나 프로 모델을 활성화할 수 있습니다.
            </p>
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="AIza... 형태의 API Key"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white mb-4"
            />
            <div className="flex items-center justify-between text-xs text-slate-500 mb-6">
              <span>키를 비워두고 저장하면 삭제됩니다.</span>
              {keyStatus === 'invalid' && <span className="text-red-400 font-bold">유효하지 않은 키</span>}
              {keyStatus === 'valid' && (
                <span className="text-green-400 font-bold">
                  검증 완료 {proAccess ? '(Pro 사용 가능)' : '(Pro 미지원)'}
                </span>
              )}
              {keyStatus === 'checking' && <span className="text-indigo-400 font-bold">검증 중...</span>}
              {keyStatus === 'saved' && <span className="text-slate-300 font-bold">저장됨 (미검증)</span>}
            </div>
            {keyMessage && (
              <p className="text-xs text-slate-300 mb-4">{keyMessage}</p>
            )}
            <div className="flex items-center gap-3 mb-4">
              <button
                onClick={handleResetKeyInput}
                className="flex-1 border border-slate-700 text-slate-400 py-2 rounded-xl font-bold hover:border-slate-500 hover:text-slate-200"
              >
                입력값 초기화
              </button>
              <button
                onClick={handleDisconnectKey}
                className="flex-1 border border-red-500/40 text-red-300 py-2 rounded-xl font-bold hover:border-red-400 hover:text-red-200"
              >
                연결 해제
              </button>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setIsKeyModalOpen(false);
                  setKeyInput(apiKey);
                }}
                className="flex-1 border border-slate-700 text-slate-300 py-3 rounded-xl font-bold hover:border-slate-500"
              >
                취소
              </button>
              <button
                onClick={handleSaveApiKey}
                className="flex-1 bg-indigo-600 text-white py-3 rounded-xl font-bold hover:bg-indigo-500"
              >
                검증 후 저장
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-6 mt-12 flex-1 w-full">
        {state.appMode === 'home' && (
          <div className="flex flex-col items-center justify-center min-h-[70vh] text-center animate-in fade-in zoom-in duration-700">
            <div className="max-w-4xl mb-16">
              <h2 className="text-6xl font-black mb-6 bg-gradient-to-b from-white to-slate-400 bg-clip-text text-transparent leading-tight tracking-tighter">One Photo, Nine Cinematic Stories.</h2>
              <p className="text-xl text-slate-400 font-medium max-w-2xl mx-auto leading-relaxed">
                단 한 장의 인물 사진을 업로드하여 AI가 생성하는 9단계의 일관성 있는 시네마틱 스토리보드를 경험해 보세요.
              </p>
            </div>

            {/* 이용 가이드 섹션 */}
            <div className="w-full max-w-5xl bg-slate-900/30 border border-slate-800 rounded-[3rem] p-10 mb-16 text-left backdrop-blur-sm shadow-2xl">
              <div className="flex items-center gap-3 mb-8">
                <i className="fas fa-info-circle text-indigo-400 text-2xl"></i>
                <h3 className="text-2xl font-bold text-white tracking-tight">서비스 이용 방법 및 특징</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
                <div className="flex gap-5">
                  <div className="flex-shrink-0 w-10 h-10 rounded-2xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-black text-lg border border-indigo-500/20 shadow-inner">1</div>
                  <div className="flex flex-col gap-1">
                    <p className="text-white font-bold text-lg">참조 이미지 업로드</p>
                    <p className="text-slate-400 text-sm leading-relaxed">캐릭터의 얼굴과 의상이 선명하게 드러난 고화질 인물 사진을 업로드하세요.</p>
                  </div>
                </div>
                <div className="flex gap-5">
                  <div className="flex-shrink-0 w-10 h-10 rounded-2xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center font-black text-lg border border-emerald-500/20 shadow-inner">2</div>
                  <div className="flex flex-col gap-1">
                    <p className="text-white font-bold text-lg">창작 모드 선택</p>
                    <p className="text-slate-400 text-sm leading-relaxed">시네마틱 앵글, 서사 전개, 혹은 줌 인/아웃 시퀀스 중 원하는 모드를 선택합니다.</p>
                  </div>
                </div>
                <div className="flex gap-5">
                  <div className="flex-shrink-0 w-10 h-10 rounded-2xl bg-amber-500/10 text-amber-400 flex items-center justify-center font-black text-lg border border-amber-500/20 shadow-inner">3</div>
                  <div className="flex flex-col gap-1">
                    <p className="text-white font-bold text-lg">나노 바나나 프로 엔진</p>
                    <p className="text-slate-400 text-sm leading-relaxed">AI가 업로드된 이미지의 '비주얼 DNA'를 추출하여 모든 장면에 동일한 인물을 구현합니다.</p>
                  </div>
                </div>
                <div className="flex gap-5">
                  <div className="flex-shrink-0 w-10 h-10 rounded-2xl bg-blue-500/10 text-blue-400 flex items-center justify-center font-black text-lg border border-blue-500/20 shadow-inner">4</div>
                  <div className="flex flex-col gap-1">
                    <p className="text-white font-bold text-lg">모델별 일일 한도 안내</p>
                    <p className="text-slate-400 text-sm leading-relaxed">가성비 모델(2.5 Flash)과 고성능 모델(3 Pro)을 선택할 수 있으며, 한도 초과 시 개인 API KEY를 등록해 계속 사용 가능합니다.</p>
                  </div>
                </div>
                <div className="flex gap-5 md:col-span-2">
                  <div className="flex-shrink-0 w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-black text-lg border border-indigo-500/20 shadow-lg">5</div>
                  <div className="flex flex-col gap-1">
                    <p className="text-white font-bold text-lg">고화질 시네마틱 렌더링</p>
                    <p className="text-slate-400 text-sm leading-relaxed">기획된 9개의 프롬프트를 확인하고 렌더링을 시작하세요. 일관성 있는 고퀄리티 장면이 순차적으로 완성됩니다.</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-10 w-full max-w-6xl">
              <div onClick={() => setState(prev => ({ ...prev, appMode: 'shorts', appStep: 'upload' }))} className="group bg-slate-900/50 p-10 rounded-[2.5rem] border border-slate-800 hover:border-indigo-500/50 transition-all cursor-pointer flex flex-col items-center">
                <div className="w-20 h-20 bg-indigo-500/10 rounded-3xl flex items-center justify-center mb-6"><i className="fas fa-film text-4xl text-indigo-400"></i></div>
                <h3 className="text-2xl font-bold mb-2">Cinematic Shots</h3>
                <p className="text-slate-500 text-sm">9가지 시네마틱 앵글</p>
              </div>
              <div onClick={() => setState(prev => ({ ...prev, appMode: 'whatsNext', appStep: 'upload' }))} className="group bg-slate-900/50 p-10 rounded-[2.5rem] border border-slate-800 hover:border-emerald-500/50 transition-all cursor-pointer flex flex-col items-center">
                <div className="w-20 h-20 bg-emerald-500/10 rounded-3xl flex items-center justify-center mb-6"><i className="fas fa-forward-step text-4xl text-emerald-400"></i></div>
                <h3 className="text-2xl font-bold mb-2">What's Next</h3>
                <p className="text-slate-500 text-sm">9가지 연속된 스토리</p>
              </div>
              <div onClick={() => setState(prev => ({ ...prev, appMode: 'zooms', appStep: 'upload' }))} className="group bg-slate-900/50 p-10 rounded-[2.5rem] border border-slate-800 hover:border-amber-500/50 transition-all cursor-pointer flex flex-col items-center">
                <div className="w-20 h-20 bg-amber-500/10 rounded-3xl flex items-center justify-center mb-6"><i className="fas fa-magnifying-glass-plus text-4xl text-amber-400"></i></div>
                <h3 className="text-2xl font-bold mb-2">Cinematic Zooms</h3>
                <p className="text-slate-500 text-sm">9단계 줌 시퀀스</p>
              </div>
            </div>
          </div>
        )}

        {state.appStep === 'upload' && state.appMode !== 'home' && (
          <div className="flex flex-col items-center justify-center min-h-[60vh] text-center animate-in slide-in-from-bottom-10">
            <h2 className="text-5xl font-black mb-6">참조 이미지 업로드</h2>
            <p className="text-slate-400 mb-12">캐릭터의 얼굴과 의상이 잘 보이는 이미지를 선택하세요.</p>
            <label className="bg-white text-slate-950 px-12 py-6 rounded-[2rem] font-black text-2xl shadow-2xl hover:bg-slate-100 transition-all cursor-pointer flex items-center gap-4">
              <i className="fas fa-upload"></i> Upload Source Image <input type="file" className="hidden" accept="image/*" onChange={handleFileUpload}/>
            </label>
            {state.isAnalyzing && <p className="mt-8 text-indigo-400 animate-pulse font-bold">이미지 분석 중...</p>}
          </div>
        )}

        {state.appStep === 'modeSetup' && (
          <div className="flex flex-col items-center justify-center min-h-[60vh] text-center animate-in fade-in">
            {state.appMode === 'whatsNext' ? (
              <>
                <h2 className="text-4xl font-black mb-12">스토리 주제 선택</h2>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 w-full max-w-5xl mb-12">
                  {state.suggestedCategories.map((cat, i) => (
                    <button key={i} onClick={() => setState(prev => ({ ...prev, selectedCategory: cat }))} className={`p-6 rounded-2xl border transition-all font-bold ${state.selectedCategory === cat ? 'bg-indigo-600 border-indigo-400' : 'bg-slate-900 border-slate-800'}`}>{cat}</button>
                  ))}
                </div>
                <input type="text" placeholder="직접 주제 입력" value={customCategory} onChange={(e) => setCustomCategory(e.target.value)} className="bg-slate-900 border border-slate-800 rounded-xl px-6 py-4 text-white w-full max-w-lg mb-8"/>
              </>
            ) : (
              <>
                <h2 className="text-4xl font-black mb-12">줌 방향을 선택하세요</h2>
                <div className="grid grid-cols-2 gap-10 w-full max-w-2xl mb-12">
                  <div onClick={() => setState(prev => ({ ...prev, zoomDirection: 'in' }))} className={`p-10 rounded-[2rem] border transition-all cursor-pointer flex flex-col items-center gap-4 ${state.zoomDirection === 'in' ? 'bg-amber-600 border-amber-400 shadow-xl' : 'bg-slate-900 border-slate-800 hover:border-slate-600'}`}>
                    <i className="fas fa-magnifying-glass-plus text-4xl"></i>
                    <span className="text-2xl font-black">Zoom-In</span>
                    <p className="text-xs opacity-60">인물 집중 확대 (Step 1 → 9)</p>
                  </div>
                  <div onClick={() => setState(prev => ({ ...prev, zoomDirection: 'out' }))} className={`p-10 rounded-[2rem] border transition-all cursor-pointer flex flex-col items-center gap-4 ${state.zoomDirection === 'out' ? 'bg-amber-600 border-amber-400 shadow-xl' : 'bg-slate-900 border-slate-800 hover:border-slate-600'}`}>
                    <i className="fas fa-magnifying-glass-minus text-4xl"></i>
                    <span className="text-2xl font-black">Zoom-Out</span>
                    <p className="text-xs opacity-60">배경 확장 축소 (Step 1 → 9)</p>
                  </div>
                </div>
              </>
            )}
            <button onClick={() => setState(prev => ({ ...prev, appStep: 'planning' }))} className="bg-white text-slate-950 px-12 py-5 rounded-2xl font-black text-xl">다음 단계 <i className="fas fa-arrow-right ml-2"></i></button>
          </div>
        )}

        {state.appStep === 'planning' && state.originalImage && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center animate-in fade-in">
            <div className="bg-slate-900 p-3 rounded-[2.5rem] border border-slate-800 shadow-2xl relative overflow-hidden">
              <img src={state.originalImage} alt="Ref" className="w-full h-full object-cover rounded-[2rem] shadow-inner"/>
              {state.isAnalyzing && (
                <div className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center p-12 text-center">
                  <div className="text-3xl font-black text-white mb-2">{state.analysisProgress}%</div>
                  <div className="w-full max-w-xs bg-slate-800 h-1.5 rounded-full overflow-hidden mb-6">
                    <div className="bg-indigo-500 h-full transition-all duration-300" style={{ width: `${state.analysisProgress}%` }}/>
                  </div>
                  <p className="text-indigo-400 font-black tracking-[0.4em] uppercase mb-4 animate-pulse">Designing Sequence</p>
                </div>
              )}
            </div>
            <div className="flex flex-col items-start">
              <h2 className="text-5xl font-black mb-8">Blueprint 생성</h2>
              {currentTheme && (
                <div className="mb-10 w-full">
                  <p className="text-xs text-slate-500 font-black uppercase tracking-widest mb-2">Selected Narrative / Mode</p>
                  <div className="bg-indigo-600/10 border border-indigo-500/20 p-6 rounded-3xl inline-block shadow-inner">
                    <span className="text-2xl font-black text-white">"{currentTheme}"</span>
                  </div>
                </div>
              )}
              <p className="text-slate-400 mb-8 font-medium leading-relaxed">캐릭터 일관성 유지를 위한 엄격한 데이터 잠금 후,<br/>9단계의 시네마틱 프롬프트를 작성합니다.</p>
              <button disabled={state.isAnalyzing} onClick={startAnalysis} className="bg-indigo-600 text-white px-14 py-6 rounded-[2rem] font-black text-2xl shadow-2xl hover:bg-indigo-500 transition-all">
                {state.isAnalyzing ? "기획 중..." : "Generate Blueprint"}
              </button>
              {error && (
                <div className="mt-6 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-300 font-bold">
                  <i className="fas fa-triangle-exclamation mr-2"></i>
                  {error}
                </div>
              )}
            </div>
          </div>
        )}

        {state.appStep === 'result' && state.plan && (
          <div className="animate-in slide-in-from-bottom-10 duration-700">
            <div className={`bg-slate-900/60 rounded-[3rem] p-12 border transition-all duration-500 mb-16 shadow-2xl backdrop-blur-sm relative overflow-hidden ${isConsistencyActive ? 'border-green-500/30 shadow-[0_0_50px_rgba(34,197,94,0.1)]' : 'border-slate-800'}`}>
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-10 mb-12 pb-12 border-b border-slate-800">
                <div>
                  <h3 className="text-sm font-black uppercase tracking-[0.4em] mb-3 text-indigo-500">
                    Blueprint: {state.appMode.toUpperCase()} SEQUENCE
                  </h3>
                  <p className="text-white text-4xl font-black tracking-tight">AI 기획서 검토 및 렌더링</p>
                </div>
                <div className="flex items-center gap-4">
                  <button onClick={() => setState(prev => ({ ...prev, isTranslated: !prev.isTranslated }))} className={`px-6 py-4 rounded-xl text-sm font-black transition-all border ${state.isTranslated ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
                    <i className="fas fa-language mr-2"></i> {state.isTranslated ? 'English' : '한국어'}
                  </button>
                  <button onClick={() => setState(prev => ({ ...prev, isEditing: !prev.isEditing }))} className={`px-6 py-4 rounded-xl text-sm font-black transition-all ${state.isEditing ? 'bg-green-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
                    <i className="fas fa-edit mr-2"></i> {state.isEditing ? 'Save' : 'Edit'}
                  </button>
                  <div className="flex bg-slate-950 p-2 rounded-2xl border border-slate-800 shadow-inner">
                    <button onClick={() => setState(prev => ({ ...prev, generationMode: 'standard' }))} className={`px-6 py-3 rounded-xl text-sm font-black transition-all ${state.generationMode === 'standard' ? 'bg-slate-800 text-white shadow-xl' : 'text-slate-500 hover:text-slate-300'}`}>Standard (Flash)</button>
                    <button onClick={() => setState(prev => ({ ...prev, generationMode: 'pro' }))} className={`px-6 py-3 rounded-xl text-sm font-black transition-all ${state.generationMode === 'pro' ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-600/20' : 'text-slate-500 hover:text-slate-300'}`}>Pro (1K)</button>
                  </div>
                </div>
              </div>

              {error && (
                <div className="mb-10 p-6 bg-red-500/10 border border-red-500/20 rounded-3xl flex items-center gap-4 text-red-400 font-bold">
                  <i className="fas fa-triangle-exclamation"></i>
                  {error}
                </div>
              )}

              <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8 mb-16">
                {[ { label: 'Identity Lock', key: 'subject', icon: 'fa-fingerprint' }, { label: 'Visual Style', key: 'style', icon: 'fa-clapperboard' }, { label: 'Aspect Ratio', key: 'aspectRatio', icon: 'fa-expand' }, { label: 'Resolution', key: 'resolution', icon: 'fa-signal' } ].map((item) => (
                  <div key={item.key} className="bg-slate-950/40 p-8 rounded-3xl border border-slate-800/60">
                    <h4 className="font-black text-indigo-400 text-xs mb-4 uppercase tracking-[0.2em] flex items-center gap-3"><i className={`fas ${item.icon}`}></i> {item.label}</h4>
                    {state.isEditing ? (
                      item.key === 'aspectRatio' || item.key === 'resolution' ? (
                        <select value={(state.plan as any)[item.key]} onChange={(e) => setState(prev => ({ ...prev, plan: { ...prev.plan!, [item.key]: e.target.value } }))} className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-sm text-slate-300 focus:ring-1 focus:ring-indigo-500">
                          {item.key === 'aspectRatio' ? ['16:9','9:16','4:3','1:1'].map(v => <option key={v} value={v}>{v}</option>) : ['1K','2K'].map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                      ) : (
                        <textarea value={(state.plan as any)[item.key]} onChange={(e) => setState(prev => ({ ...prev, plan: { ...prev.plan!, [item.key]: e.target.value } }))} className="w-full h-24 bg-slate-900 border border-slate-700 rounded-xl p-3 text-sm text-slate-300 focus:ring-1 focus:ring-indigo-500"/>
                      )
                    ) : <p className="text-slate-300 text-sm leading-relaxed">{(state.plan as any)[item.key]}</p>}
                  </div>
                ))}
              </div>

              {state.isEditing && (
                <button onClick={handleSaveEdits} className="mb-10 bg-indigo-600 text-white px-8 py-3 rounded-xl font-bold hover:bg-indigo-500 transition-all">Apply & Re-generate Prompts</button>
              )}

              <div className="flex flex-wrap gap-8 items-center">
                <button onClick={generateAllImages} disabled={state.isGeneratingAll || state.isEditing} className={`px-12 py-6 rounded-[2rem] font-black text-2xl shadow-xl transition-all disabled:opacity-50 
                  ${isConsistencyActive ? 'bg-green-600 text-white hover:bg-green-500 shadow-green-500/20' : state.generationMode === 'pro' ? 'bg-indigo-600 text-white hover:bg-indigo-500' : 'bg-white text-slate-950 hover:bg-slate-200'}`}>
                  {state.isGeneratingAll ? <><i className="fas fa-spinner fa-spin mr-2"></i> Rendering...</> : 
                   isConsistencyActive ? "Production (Nano Pro 1K)" : "Standard Production"}
                </button>
                <button
                  onClick={handleDownloadAllImages}
                  className="px-8 py-5 rounded-[2rem] font-black text-lg bg-slate-800 text-slate-200 border border-slate-700 hover:border-indigo-500/60 hover:text-white transition-all"
                >
                  <i className="fas fa-download mr-2"></i> Download All
                </button>
                <div className="flex flex-col">
                  <span className="text-sm text-slate-400 font-bold uppercase tracking-widest">
                    {state.generationMode === 'pro' ? 'Nano-Banana Pro v3.0' : 'Nano-Banana Flash v2.5'}
                  </span>
                  <div className="flex items-center gap-2 mt-1">
                    <div className={`w-2 h-2 rounded-full transition-all duration-500 ${isConsistencyActive ? 'bg-green-500 shadow-[0_0_12px_rgba(34,197,94,1)]' : 'bg-slate-600'}`}></div>
                    <span className={`text-[10px] font-black uppercase tracking-widest transition-colors duration-500 ${isConsistencyActive ? 'text-green-400' : 'text-slate-600'}`}>
                      Consistency Lock {isConsistencyActive ? 'ACTIVE' : 'READY'}
                    </span>
                  </div>
                  {state.generationMode === 'pro' && keyStatus !== 'valid' && (
                    <span className="text-[10px] text-amber-500 font-bold mt-1">Pro 모드는 일일 한도 소진 시 API Key가 필요합니다.</span>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10">
              {state.angles.map((angle) => (
                <div key={angle.id} className="bg-slate-900 rounded-[2.5rem] overflow-hidden border border-slate-800 flex flex-col group transition-all hover:border-indigo-500/30">
                  <div className="relative aspect-video bg-black flex items-center justify-center">
                    {angle.imageUrl ? <img src={angle.imageUrl} alt={angle.name} className="w-full h-full object-cover animate-in fade-in duration-700"/> : (
                      <div className="flex flex-col items-center">
                        {angle.status === 'generating' ? <i className="fas fa-circle-notch fa-spin text-4xl text-indigo-500"></i> : <i className="fas fa-video text-6xl text-slate-800 opacity-20"></i>}
                      </div>
                    )}
                    <div className="absolute top-5 left-5 bg-black/80 backdrop-blur-md px-4 py-2 rounded-2xl text-[10px] font-black text-white uppercase tracking-[0.3em] border border-white/10">
                      STEP 0{angle.id + 1}
                    </div>
                    {angle.status === 'error' && (
                       <div className="absolute inset-0 bg-red-950/40 flex items-center justify-center backdrop-blur-sm">
                          <button onClick={() => generateAngleImage(angle.id)} className="bg-red-500 text-white px-4 py-2 rounded-xl font-bold text-xs"><i className="fas fa-redo mr-2"></i> Retry</button>
                       </div>
                    )}
                  </div>
                  <div className="p-10 flex-1 flex flex-col">
                    <div className="flex items-center justify-between mb-8">
                      <h4 className="font-black text-white text-xl tracking-tight">{angle.name}</h4>
                      <div className="flex items-center gap-2">
                        {angle.imageUrl && (
                          <button
                            onClick={() => handleDownloadImage(angle)}
                            className="w-12 h-12 rounded-2xl bg-slate-800 text-slate-200 flex items-center justify-center hover:bg-indigo-600 hover:text-white transition-all shadow-inner"
                          >
                            <i className="fas fa-download text-sm"></i>
                          </button>
                        )}
                        {!state.isEditing && angle.status !== 'completed' && angle.status !== 'generating' && (
                          <button onClick={() => generateAngleImage(angle.id)} className="w-12 h-12 rounded-2xl bg-indigo-600/10 text-indigo-400 flex items-center justify-center hover:bg-indigo-600 hover:text-white transition-all shadow-inner"><i className="fas fa-play text-sm"></i></button>
                        )}
                      </div>
                    </div>
                    <div className="bg-slate-950 p-6 rounded-3xl border border-white/5 flex-1 shadow-inner">
                       <div className="flex items-center justify-between mb-4">
                          <p className="text-[10px] text-slate-600 font-black uppercase tracking-[0.2em]">{state.isTranslated ? '번역된 기획' : 'Identity-Locked Prompt'}</p>
                          <button onClick={() => copyToClipboard(state.isTranslated ? angle.promptKo : angle.prompt, angle.id)} className="text-[10px] font-black px-4 py-2 rounded-xl bg-white/5 text-slate-400 hover:bg-white/10">
                            <i className={`fas ${copiedId === angle.id ? 'fa-check text-green-400' : 'fa-copy'}`}></i>
                          </button>
                       </div>
                       <textarea readOnly className="text-xs text-slate-500 bg-transparent border-none focus:ring-0 resize-none w-full h-32 italic scrollbar-hide font-medium leading-relaxed" value={state.isTranslated ? angle.promptKo : angle.prompt}/>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      <footer className="mt-20 mb-12 flex justify-center px-6">
        <a 
          href="https://litt.ly/aklabs" 
          target="_blank" 
          rel="noopener noreferrer"
          className="bg-white/95 backdrop-blur-md rounded-[2.5rem] p-6 md:p-8 flex items-center justify-between gap-8 max-w-2xl w-full shadow-[0_20px_50px_rgba(0,0,0,0.3)] hover:scale-[1.03] active:scale-95 transition-all cursor-pointer group"
        >
          <div className="flex flex-col">
            <span className="text-slate-900 font-black text-xl md:text-2xl tracking-tight leading-tight">나만의 AI 웹앱을 만들고 싶다면?</span>
            <span className="text-indigo-600 font-bold text-sm md:text-lg mt-2 tracking-tight">아크랩스에서 AI 마스터가 되어보세요</span>
          </div>
          <div className="min-w-[56px] w-14 h-14 bg-slate-950 rounded-2xl flex items-center justify-center text-white group-hover:bg-indigo-600 group-hover:shadow-[0_0_20px_rgba(79,70,229,0.4)] transition-all duration-300">
            <i className="fas fa-chevron-right text-xl"></i>
          </div>
        </a>
      </footer>
    </div>
  );
};

export default App;
