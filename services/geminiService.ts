
import { GoogleGenAI, Chat, GenerateContentResponse, Content, Part, Modality } from "@google/genai";
import { ModelType } from "../types";

let ai: GoogleGenAI | null = null;

export const getAiClient = (): GoogleGenAI => {
  if (!ai) {
    ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  }
  return ai;
};

interface SessionConfig {
  model: string;
  temperature: number;
  systemInstruction: string;
  useThinking: boolean;
  useSearch: boolean;
  useMaps: boolean;
}

export const createChatSession = (
  config: SessionConfig,
  history?: Content[]
): Chat => {
  const client = getAiClient();
  
  const tools: any[] = [];
  if (config.useSearch) {
    tools.push({ googleSearch: {} });
  }
  if (config.useMaps) {
    tools.push({ googleMaps: {} });
  }

  // Determine effective model
  // If Thinking is enabled, we prefer a model that supports it well (like Pro)
  const effectiveModel = config.useThinking ? ModelType.PRO : config.model;

  const generationConfig: any = {
    systemInstruction: config.systemInstruction,
    tools: tools.length > 0 ? tools : undefined,
  };

  if (!config.useThinking) {
     // Only apply temperature if NOT thinking (thinking models manage their own diversity mostly via budget)
     generationConfig.temperature = config.temperature;
  }

  if (config.useThinking) {
    // Enable thinking with a reasonable budget
    generationConfig.thinkingConfig = { thinkingBudget: 16384 }; 
  }

  // Map configuration needs to know the user's location for "near me" queries
  if (config.useMaps) {
    generationConfig.toolConfig = {
      retrievalConfig: {
        // This is a placeholder. In a real app, you would get this from navigator.geolocation
        // For now, we let the model infer or ask, but providing latLng improves accuracy.
        latLng: {
          latitude: 37.7749, // Defaulting to SF for demo, or handle dynamic injection
          longitude: -122.4194
        }
      }
    }
  }

  return client.chats.create({
    model: effectiveModel,
    config: generationConfig,
    history: history,
  });
};

export const sendMessageStream = async (
  chat: Chat,
  text: string,
  image: { data: string; mimeType: string } | null,
  onChunk: (text: string, thought?: string) => void
): Promise<void> => {
  try {
    let messagePayload: string | Part[] = text;

    if (image) {
      messagePayload = [
        { text: text },
        {
          inlineData: {
            mimeType: image.mimeType,
            data: image.data
          }
        }
      ];
    }

    const resultStream = await chat.sendMessageStream({ message: messagePayload });
    
    for await (const chunk of resultStream) {
      // Extract text
      const textPart = chunk.text;
      if (textPart) {
        onChunk(textPart);
      }
    }
  } catch (error) {
    console.error("Error streaming message:", error);
    throw error;
  }
};

// --- Audio Services ---

export const transcribeAudio = async (audioBase64: string): Promise<string> => {
  const client = getAiClient();
  // Use Flash for fast transcription
  const response = await client.models.generateContent({
    model: ModelType.FLASH,
    contents: {
      role: 'user',
      parts: [
        { inlineData: { mimeType: 'audio/wav', data: audioBase64 } },
        { text: "Transcribe this audio exactly as spoken. Do not add any other text." }
      ]
    }
  });
  return response.text || "";
};

// --- Vision Services ---

export const extractTextFromImage = async (imageBase64: string, mimeType: string = 'image/jpeg'): Promise<string> => {
  const client = getAiClient();
  const response = await client.models.generateContent({
    model: ModelType.FLASH,
    contents: {
      role: 'user',
      parts: [
        { inlineData: { mimeType: mimeType, data: imageBase64 } },
        { text: "OCR Task: Extract and output ALL text visible in this image. Preserve formatting where possible. Do not add conversational filler. Just return the text." }
      ]
    }
  });
  return response.text || "";
};

export const generateSpeech = async (text: string): Promise<ArrayBuffer> => {
  const client = getAiClient();
  const response = await client.models.generateContent({
    model: ModelType.TTS,
    contents: {
      parts: [{ text: text }]
    },
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' }
        }
      }
    }
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) throw new Error("No audio generated");

  // Decode base64 to ArrayBuffer
  const binaryString = atob(base64Audio);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
};