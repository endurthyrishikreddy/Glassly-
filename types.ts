export interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  isStreaming?: boolean;
  timestamp: number;
  thoughtProcess?: string; // For thinking model output
  hasAudio?: boolean; // If message has TTS audio available
}

export interface ChatState {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  config: {
    useSearch: boolean;
    useThinking: boolean;
    isScreenActive: boolean;
  };
}

export enum ModelType {
  FLASH = 'gemini-2.5-flash',
  PRO = 'gemini-3-pro-preview',
  TTS = 'gemini-2.5-flash-preview-tts',
}
