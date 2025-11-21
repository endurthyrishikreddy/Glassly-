import { GoogleGenAI, Chat, GenerateContentResponse, Content, Part, Modality } from "@google/genai";
import { ModelType } from "../types";

let ai: GoogleGenAI | null = null;

export const getAiClient = (): GoogleGenAI => {
  if (!ai) {
    ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  }
  return ai;
};

export const createChatSession = (
  model: string,
  systemInstruction?: string,
  history?: Content[],
  useThinking: boolean = false,
  useSearch: boolean = false
): Chat => {
  const client = getAiClient();
  
  const tools = [];
  if (useSearch) {
    tools.push({ googleSearch: {} });
  }

  const config: any = {
    systemInstruction: systemInstruction || "You are a helpful, concise AI assistant living in a transparent glass overlay. Keep answers brief and relevant.",
    tools: tools.length > 0 ? tools : undefined,
  };

  if (useThinking && model.includes('gemini-3-pro')) {
    config.thinkingConfig = { thinkingBudget: 16384 }; // Set budget for thinking
  }

  return client.chats.create({
    model: model,
    config: config,
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
      
      // Extract thinking process if available (depends on structure, usually in candidate parts)
      // Note: The SDK handles basic text extraction via .text, but specific "thought" parts might need manual inspection
      // For now, we rely on the model returning the thought in the stream which usually appears before the final answer
      // or as part of the text if not separated. 
      // Gemini 2.5 thinking models often output thoughts in specific parts, but for this implementation
      // we will primarily consume the .text property which aggregates the output.
      
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
