
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { StoryboardPlan, AppMode, ZoomDirection } from "./types";

const resolveApiKey = (apiKey?: string) =>
  apiKey || process.env.API_KEY || process.env.GEMINI_API_KEY;

const REQUEST_TIMEOUT_MS = 45000;
const VALIDATION_TIMEOUT_MS = 15000;

const PLAN_MODELS = ["gemini-2.5-pro", "gemini-2.5-flash"] as const;
const IMAGE_MODELS = {
  pro: "gemini-3-pro-image-preview",
  fallback: "gemini-2.5-flash-image"
} as const;

const withTimeout = async <T>(promise: Promise<T>, ms: number) =>
  await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("REQUEST_TIMEOUT")), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });

const getAI = (apiKey?: string) => {
  const resolvedKey = resolveApiKey(apiKey);
  if (!resolvedKey) throw new Error("API_KEY_MISSING");
  return new GoogleGenAI({ apiKey: resolvedKey });
};

const isModelAccessError = (error: any) => {
  const message = String(error?.message || "");
  return (
    message === "REQUEST_TIMEOUT" ||
    message.includes("Requested entity was not found") ||
    message.toLowerCase().includes("not found") ||
    message.toLowerCase().includes("permission") ||
    message.toLowerCase().includes("denied") ||
    message.toLowerCase().includes("not authorized")
  );
};

const generateWithFallback = async <T>(
  ai: GoogleGenAI,
  models: readonly string[],
  requestFactory: (model: string) => Promise<T>
) => {
  let lastError: any;
  for (const model of models) {
    try {
      return await withTimeout(requestFactory(model), REQUEST_TIMEOUT_MS);
    } catch (error: any) {
      lastError = error;
      if (!isModelAccessError(error)) throw error;
    }
  }
  throw lastError;
};

/**
 * 현재 설정된 API Key가 실제로 유효한지 테스트합니다.
 */
export const validateApiKey = async (
  apiKey?: string
): Promise<{ valid: boolean; proAvailable: boolean }> => {
  const resolvedKey = resolveApiKey(apiKey);
  if (!resolvedKey) return { valid: false, proAvailable: false };
  try {
    const ai = new GoogleGenAI({ apiKey: resolvedKey });
    try {
      await withTimeout(
        ai.models.generateContent({
          model: PLAN_MODELS[0],
          contents: 'test',
          config: { maxOutputTokens: 1 }
        }),
        VALIDATION_TIMEOUT_MS
      );
      return { valid: true, proAvailable: true };
    } catch (error: any) {
      if (!isModelAccessError(error)) throw error;
    }

    await withTimeout(
      ai.models.generateContent({
        model: PLAN_MODELS[1],
        contents: 'test',
        config: { maxOutputTokens: 1 }
      }),
      VALIDATION_TIMEOUT_MS
    );
    return { valid: true, proAvailable: false };
  } catch (error) {
    console.error("API Key Validation Error:", error);
    return { valid: false, proAvailable: false };
  }
};

export const suggestNarrativeCategories = async (
  base64Image: string,
  apiKey?: string
): Promise<string[]> => {
  const ai = getAI(apiKey);
  const prompt = `
    이미지를 보고 이후에 이어질 수 있는 스토리 카테고리를 5개 추천해주세요.
    JSON 배열 형태 ["카테고리1", ...] 로만 응답하세요.
  `;

  const response = await generateWithFallback(
    ai,
    PLAN_MODELS,
    (model) =>
      ai.models.generateContent({
        model,
        contents: {
          parts: [
            { inlineData: { mimeType: 'image/jpeg', data: base64Image.split(',')[1] } },
            { text: prompt }
          ]
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          }
        }
      })
  );

  const text = response.text;
  if (!text) return ["액션", "드라마", "SF", "판타지", "일상"];
  return JSON.parse(text);
};

export const analyzeImageToStoryboardPlan = async (
  base64Image: string, 
  mode: AppMode, 
  category: string | null = null,
  zoomDirection: ZoomDirection = 'in',
  apiKey?: string
): Promise<StoryboardPlan> => {
  const ai = getAI(apiKey);
  
  const commonInstruction = `
    **CRITICAL CHARACTER CONSISTENCY RULE:**
    1. Analyze the person in the source image with extreme precision: 
       - Ethnicity: (e.g., East Asian, Caucasian, etc.)
       - Facial Features: (e.g., eye shape, nose, smile, facial structure)
       - Hairstyle: (e.g., long black hair with bangs, bob, etc.)
       - Clothing: (e.g., white linen shirt, specific patterns)
    2. In the 'subject' field, write a definitive physical description that locks this identity.
    3. Every shot prompt must start with: "High-quality realistic photo of the EXACT same person from the reference image, maintaining their identical face, hair, and outfit: "
  `;

  const shortsPrompt = `
    ${commonInstruction}
    당신은 전문적인 '시네마틱 스토리보드 아티스트'입니다.
    이미지를 분석하여 9가지 시네마틱 앵글을 설계하세요.
    모든 prompt는 영어로, promptKo는 한국어로 작성하세요.
  `;

  const whatsNextPrompt = `
    ${commonInstruction}
    당신은 전문적인 '비주얼 스토리텔러'입니다.
    주제: [${category || '일반적인 서사'}]
    9가지 연속된 스토리 장면을 구상하세요. 
    인물의 일관성이 절대적으로 유지되어야 합니다. 외국인이나 다른 인물로 바뀌지 않도록 주의하세요.
    모든 prompt는 상세한 영어로 작성하고, promptKo는 한국어로 작성하세요.
  `;

  const zoomsPrompt = `
    ${commonInstruction}
    당신은 전문적인 '시네마틱 비주얼 이펙트(VFX) 감독'입니다.
    줌 모드: [${zoomDirection === 'in' ? '확대(Zoom-in)' : '축소(Zoom-out)'}]
    9단계 줌 시퀀스를 설계하세요. 모든 단계에서 인물의 특징이 완벽히 유지되어야 합니다.
  `;

  const systemInstruction = 
    mode === 'whatsNext' ? whatsNextPrompt : 
    mode === 'zooms' ? zoomsPrompt : 
    shortsPrompt;

  const response = await generateWithFallback(
    ai,
    PLAN_MODELS,
    (model) =>
      ai.models.generateContent({
        model,
        contents: {
          parts: [
            { inlineData: { mimeType: 'image/jpeg', data: base64Image.split(',')[1] } },
            { text: systemInstruction }
          ]
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              subject: { type: Type.STRING, description: '상세한 캐릭터 외모 묘사 (Identity Lock)' },
              style: { type: Type.STRING, description: '전체적인 조명 및 시네마틱 스타일' },
              resolution: { type: Type.STRING },
              aspectRatio: { type: Type.STRING },
              angles: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    prompt: { type: Type.STRING },
                    promptKo: { type: Type.STRING }
                  },
                  required: ['name', 'prompt', 'promptKo']
                }
              }
            },
            required: ['subject', 'style', 'resolution', 'aspectRatio', 'angles']
          }
        }
      })
  );

  const text = response.text;
  if (!text) throw new Error("AI 응답 실패");
  return JSON.parse(text) as StoryboardPlan;
};

export const updatePromptsWithEdits = async (
  plan: StoryboardPlan, 
  mode: AppMode,
  apiKey?: string
): Promise<StoryboardPlan> => {
  const ai = getAI(apiKey);
  const prompt = `
    다음 수정 사항을 바탕으로 9개의 장면 프롬프트를 다시 작성하세요.
    인물의 일관성이 최우선입니다.
    [Identity Lock] ${plan.subject}
    [Visual Style] ${plan.style}
    
    규칙: 모든 프롬프트는 "Based on the reference photo, maintaining the exact same identity, face, and attire: "로 시작해야 합니다.
  `;

  const response = await generateWithFallback(
    ai,
    PLAN_MODELS,
    (model) =>
      ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              subject: { type: Type.STRING },
              style: { type: Type.STRING },
              resolution: { type: Type.STRING },
              aspectRatio: { type: Type.STRING },
              angles: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    prompt: { type: Type.STRING },
                    promptKo: { type: Type.STRING }
                  },
                  required: ['name', 'prompt', 'promptKo']
                }
              }
            },
            required: ['subject', 'style', 'resolution', 'aspectRatio', 'angles']
          }
        }
      })
  );

  const text = response.text;
  if (!text) throw new Error("업데이트 실패");
  return JSON.parse(text) as StoryboardPlan;
};

/**
 * 인물 일관성을 극대화하여 이미지를 생성합니다.
 */
export const generateStoryShot = async (
  prompt: string, 
  originalImageBase64: string,
  isPro: boolean = false, 
  config: {aspectRatio: string, resolution: string},
  apiKey?: string
): Promise<string> => {
  const resolvedKey = resolveApiKey(apiKey);
  if (!resolvedKey) throw new Error("API_KEY_MISSING");
  const ai = new GoogleGenAI({ apiKey: resolvedKey });
  // API Key가 있다면 무조건 Pro 모델 사용 (사용자가 Pro 버튼을 눌렀을 때만 작동하는 것이 아니라, 가능하면 Pro 사용)
  const modelName = isPro ? IMAGE_MODELS.pro : IMAGE_MODELS.fallback;
  
  // 참조 이미지를 '첫 번째 파트'로 명확히 주입하여 모델이 이를 가장 중요한 컨텍스트로 인지하게 함
  const contents = {
    parts: [
      {
        inlineData: {
          mimeType: 'image/jpeg',
          data: originalImageBase64.split(',')[1]
        }
      },
      {
        text: `
          STRICT IDENTITY MATCH REQUIRED: 
          Look at the person in the provided image. Replicate their EXACT facial features, hair, and clothing in a new scene.
          
          SCENE DESCRIPTION: ${prompt}
          
          STYLE: Cinematic, professional photography, high-end resolution, masterwork quality.
          No variations in the person's identity allowed.
        `
      }
    ]
  };

  try {
    const response = await withTimeout(
      ai.models.generateContent({
        model: modelName,
        contents,
        config: {
          imageConfig: {
            aspectRatio: (config.aspectRatio as any) || "16:9",
            imageSize: isPro ? (config.resolution as any || "1K") : undefined
          }
        }
      }),
      REQUEST_TIMEOUT_MS
    );

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
  } catch (error: any) {
    if (isPro && (isModelAccessError(error) || error.message === "REQUEST_TIMEOUT")) {
      const fallbackResponse = await withTimeout(
        ai.models.generateContent({
          model: IMAGE_MODELS.fallback,
          contents,
          config: {
            imageConfig: {
              aspectRatio: (config.aspectRatio as any) || "16:9"
            }
          }
        }),
        REQUEST_TIMEOUT_MS
      );

      for (const part of fallbackResponse.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          return `data:image/png;base64,${part.inlineData.data}`;
        }
      }
    }
    if (error.message?.includes("Requested entity was not found")) throw new Error("API_KEY_INVALID");
    throw error;
  }
  throw new Error("이미지 생성 실패");
};
