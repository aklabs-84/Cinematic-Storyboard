
export type AppMode = 'home' | 'shorts' | 'whatsNext' | 'zooms';
export type AppStep = 'upload' | 'modeSetup' | 'planning' | 'result';
export type ZoomDirection = 'in' | 'out';

export interface StoryboardAngle {
  id: number;
  name: string;
  description: string;
  prompt: string;
  promptKo: string;
  imageUrl?: string;
  status: 'pending' | 'generating' | 'completed' | 'error';
}

export interface StoryboardPlan {
  subject: string;
  style: string;
  resolution: string;
  aspectRatio: string;
  angles: {
    name: string;
    prompt: string;
    promptKo: string;
  }[];
}

export interface AppState {
  appMode: AppMode;
  appStep: AppStep;
  originalImage: string | null;
  plan: StoryboardPlan | null;
  angles: StoryboardAngle[];
  isAnalyzing: boolean;
  analysisProgress: number;
  isGeneratingAll: boolean;
  generationMode: 'standard' | 'pro';
  suggestedCategories: string[];
  selectedCategory: string | null;
  zoomDirection: ZoomDirection;
  isTranslated: boolean;
  isEditing: boolean;
}
