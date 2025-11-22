import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { 
  Send, Sparkles, RefreshCw, Minimize2, Maximize2, ExternalLink, 
  WifiOff, Wifi, Eye, X, Mic, BrainCircuit, Globe, Monitor, GripHorizontal,
  Ghost, EyeOff, Settings, ChevronLeft, Save, Crop, ScanLine, Check, Image as ImageIcon,
  Loader2, CheckCircle, MapPin, ChevronDown, Cpu, Wrench, Palette, Sliders, MessageSquare,
  History, Trash2, Archive, Clock, CloudOff
} from 'lucide-react';
import { Message, ChatState, ModelType, ChatSession } from '../types';
import { createChatSession, sendMessageStream, transcribeAudio, extractTextFromImage } from '../services/geminiService';
import { MessageBubble } from './MessageBubble';
import { Chat, Content } from "@google/genai";

// --- Type Definitions ---
interface ImageCapture {
  grabFrame(): Promise<ImageBitmap>;
}
declare var ImageCapture: {
  prototype: ImageCapture;
  new (track: MediaStreamTrack): ImageCapture;
};

// Updated key to ensure clean config load for new features
const STORAGE_KEY = 'gemini_glass_overlay_history_v6';
const SAVED_SESSIONS_KEY = 'gemini_glass_saved_sessions_v1';

interface ScreenshotData {
  data: string; // base64
  mimeType: string;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// --- Helper Component for Settings Section ---
interface SettingsSectionProps {
  id: string;
  title: string;
  icon: any;
  activeSection: string;
  onToggle: (id: string) => void;
  children: React.ReactNode;
}

const SettingsSection: React.FC<SettingsSectionProps> = ({ id, title, icon: Icon, activeSection, onToggle, children }) => {
  const isOpen = activeSection === id;
  return (
    <div className={`rounded-xl overflow-hidden border transition-all duration-300 ${isOpen ? 'bg-white/5 border-white/20' : 'bg-transparent border-white/5 hover:bg-white/5'}`}>
        <button
            onClick={() => onToggle(isOpen ? '' : id)}
            className="w-full flex items-center justify-between p-4 transition-colors outline-none"
        >
            <div className="flex items-center gap-3 text-white/90">
                <div className={`p-2 rounded-lg transition-colors ${isOpen ? 'bg-indigo-500/20 text-indigo-300' : 'bg-white/5 text-white/40'}`}>
                    <Icon size={18} />
                </div>
                <span className="font-medium text-sm tracking-wide">{title}</span>
            </div>
            <ChevronDown size={16} className={`text-white/40 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
        </button>
        <div className={`transition-all duration-300 ease-in-out overflow-hidden ${isOpen ? 'max-h-[1000px] opacity-100' : 'max-h-0 opacity-0'}`}>
            <div className="p-4 pt-0 border-t border-white/5">
                <div className="pt-4 space-y-4">
                    {children}
                </div>
            </div>
        </div>
    </div>
  );
};

const DEFAULT_SYSTEM_INSTRUCTION = `You are a helpful, concise AI assistant living in a transparent glass overlay.
Keep answers brief and relevant.
If the user asks for a visualization, chart, or graph, respond with a JSON code block in the following format:
\`\`\`json
{
  "type": "bar" | "line" | "area" | "pie",
  "title": "Chart Title",
  "data": [ {"name": "Category A", "val1": 10, "val2": 20}, ... ],
  "xAxisKey": "name",
  "series": [ {"dataKey": "val1", "name": "Metric 1", "color": "#6366f1"} ]
}
\`\`\`
Follow the JSON with a brief textual summary.`;

export const GlassOverlay: React.FC = () => {
  // --- State ---
  const [isOpen, setIsOpen] = useState(true);
  const [isMinimized, setIsMinimized] = useState(false);
  const [inputText, setInputText] = useState('');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isRecording, setIsRecording] = useState(false);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null); // For screen capture
  const [isScreenShared, setIsScreenShared] = useState(false);
  
  // Stealth & Visibility
  const [isStealth, setIsStealth] = useState(false); // Low opacity mode
  const [isVisible, setIsVisible] = useState(true);  // Fully hidden/shown toggle
  const [showSettings, setShowSettings] = useState(false); // Settings View Toggle
  const [showHistory, setShowHistory] = useState(false); // History View Toggle
  const [activeSettingsSection, setActiveSettingsSection] = useState<string>('model'); // 'model', 'tools', 'creativity'
  
  // Resize State
  const [size, setSize] = useState<{width: number, height: number}>({ width: 0, height: 0 }); // 0 means use defaults/CSS
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState<string | null>(null);
  const resizeStartRef = useRef<{x: number, y: number, w: number, h: number, posX: number, posY: number} | null>(null);

  // Cropping / Snipping Tool State
  const [isCropping, setIsCropping] = useState(false);
  const [tempScreenshot, setTempScreenshot] = useState<string | null>(null);
  const [cropRect, setCropRect] = useState<Rect | null>(null);
  const [isDrawingCrop, setIsDrawingCrop] = useState(false);
  const [cropStart, setCropStart] = useState<{x: number, y: number} | null>(null);
  const [attachedImage, setAttachedImage] = useState<ScreenshotData | null>(null);
  
  // OCR & Feedback State
  const [ocrState, setOcrState] = useState<'idle' | 'scanning' | 'success' | 'error'>('idle');
  const [inputHighlight, setInputHighlight] = useState(false);

  // PiP State
  const [isPiP, setIsPiP] = useState(false);
  const pipWindowRef = useRef<Window | null>(null);
  
  // Persistent State
  const [chatState, setChatState] = useState<ChatState>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          // Robust Migration for configs
          const config = parsed.config || {};
          return {
            messages: parsed.messages || [],
            isLoading: false,
            error: null,
            config: {
              useSearch: config.useSearch ?? false, // Use ?? to allow false as valid
              useMaps: config.useMaps ?? false,
              useThinking: config.useThinking ?? false,
              isScreenActive: false,
              model: config.model || ModelType.FLASH,
              temperature: config.temperature !== undefined ? config.temperature : 0.7,
              systemInstruction: config.systemInstruction || DEFAULT_SYSTEM_INSTRUCTION
            }
          };
        } catch (e) { console.error("Failed to load chat state", e); }
      }
    }
    // Default Initial State
    return {
      messages: [{
        id: 'welcome',
        role: 'model',
        text: "I am your advanced AI overlay. I can see your screen, browse the web, and generate charts for you.",
        timestamp: Date.now()
      }],
      isLoading: false,
      error: null,
      config: { 
        useSearch: false, 
        useMaps: false,
        useThinking: false, 
        isScreenActive: false,
        model: ModelType.FLASH,
        temperature: 0.7,
        systemInstruction: DEFAULT_SYSTEM_INSTRUCTION
      }
    };
  });

  // Saved Sessions State
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(SAVED_SESSIONS_KEY);
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch (e) { console.error("Failed to load saved sessions", e); }
      }
    }
    return [];
  });

  // Refs
  const chatSessionRef = useRef<Chat | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  
  // Dragging State
  const [position, setPosition] = useState<{x: number, y: number} | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragOffsetRef = useRef<{x: number, y: number}>({ x: 0, y: 0 });

  // --- Effects ---

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === 'h' || e.key === 'H')) {
        setIsVisible(prev => !prev);
      }
      if (e.altKey && (e.key === 's' || e.key === 'S')) {
        setIsStealth(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Network Listener
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Persist Current State to LocalStorage
  useEffect(() => {
    const stateToSave = {
      messages: chatState.messages,
      config: chatState.config // content of this object is verified to contain all keys
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
  }, [chatState.messages, chatState.config]);

  // Persist Sessions to LocalStorage
  useEffect(() => {
    localStorage.setItem(SAVED_SESSIONS_KEY, JSON.stringify(sessions));
  }, [sessions]);

  // Input Highlight Timeout
  useEffect(() => {
    if (inputHighlight) {
      const timer = setTimeout(() => setInputHighlight(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [inputHighlight]);

  // Initialize Chat (Re-create if config changes)
  const initializeChat = useCallback(() => {
    const history: Content[] = chatState.messages.map(msg => ({
      role: msg.role,
      parts: [{ text: msg.text }]
    }));
    
    chatSessionRef.current = createChatSession(
      {
        model: chatState.config.model,
        temperature: chatState.config.temperature,
        systemInstruction: chatState.config.systemInstruction,
        useThinking: chatState.config.useThinking,
        useSearch: chatState.config.useSearch,
        useMaps: chatState.config.useMaps
      },
      history
    );
  }, [chatState.messages, chatState.config]);

  // Initial Load
  useEffect(() => {
    initializeChat();
  }, []); // Run once on mount

  // Scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };
  useEffect(() => {
    if (!isMinimized && isVisible && !showSettings && !showHistory && !isCropping) scrollToBottom();
  }, [chatState.messages, isOpen, isMinimized, isPiP, isVisible, showSettings, showHistory, isCropping]);

  // --- Features ---

  // History / Session Management
  const handleSaveSession = () => {
    if (chatState.messages.length <= 1) return; // Don't save empty default chats

    const firstUserMessage = chatState.messages.find(m => m.role === 'user');
    const title = firstUserMessage 
      ? (firstUserMessage.text.slice(0, 30) + (firstUserMessage.text.length > 30 ? '...' : ''))
      : 'New Chat Session';

    const newSession: ChatSession = {
      id: Date.now().toString(),
      title,
      timestamp: Date.now(),
      messages: chatState.messages,
      config: chatState.config
    };

    setSessions(prev => [newSession, ...prev]);
    // Visual feedback could be added here
  };

  const handleLoadSession = (session: ChatSession) => {
    setChatState({
      messages: session.messages,
      isLoading: false,
      error: null,
      config: session.config
    });
    setShowHistory(false);
    setTimeout(scrollToBottom, 100);
  };

  const handleDeleteSession = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setSessions(prev => prev.filter(s => s.id !== id));
  };

  // 1. Screen Sharing (Vision)
  const toggleScreenShare = async (): Promise<MediaStream | null> => {
    if (isScreenShared && mediaStream) {
      // Stop sharing
      mediaStream.getTracks().forEach(track => track.stop());
      setMediaStream(null);
      setIsScreenShared(false);
      if (isCropping) cancelCrop();
      return null;
    } else {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { cursor: "always" } as any,
          audio: false
        });
        
        stream.getVideoTracks()[0].onended = () => {
          setIsScreenShared(false);
          setMediaStream(null);
          if (isCropping) cancelCrop();
        };

        setMediaStream(stream);
        setIsScreenShared(true);
        return stream;
      } catch (err) {
        console.log("Screen share cancelled or denied");
        if (err instanceof DOMException && err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
            setChatState(prev => ({...prev, error: "Screen share failed. Check permissions."}));
        }
        return null;
      }
    }
  };

  const captureFrame = async (streamToUse?: MediaStream): Promise<ScreenshotData | null> => {
    const activeStream = streamToUse || mediaStream;
    if (!activeStream) return null;
    
    const wasVisible = isVisible;
    const wasCropping = isCropping; 

    // Only hide if we are visible, not in PiP, and not already looking at a static crop image.
    if (wasVisible && !isPiP && !wasCropping) {
       setIsVisible(false);
       await new Promise(resolve => setTimeout(resolve, 300));
    }

    try {
      const track = activeStream.getVideoTracks()[0];
      const imageCapture = new ImageCapture(track);
      const bitmap = await imageCapture.grabFrame();
      
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      if (context) {
        context.drawImage(bitmap, 0, 0);
        const base64Url = canvas.toDataURL('image/jpeg', 0.85);
        
        if (wasVisible && !isPiP && !wasCropping) setIsVisible(true);
        
        return {
          data: base64Url.split(',')[1],
          mimeType: 'image/jpeg'
        };
      }
    } catch (e) {
      console.error("Capture failed", e);
      if (wasVisible && !isPiP && !wasCropping) setIsVisible(true);
    }
    return null;
  };

  // --- Crop / Region Capture Logic ---
  
  const startRegionCapture = async () => {
    let stream = mediaStream;
    if (!stream) {
      stream = await toggleScreenShare();
    }
    if (!stream) return;
    if (!mediaStream) await new Promise(r => setTimeout(r, 500));

    const screenShot = await captureFrame(stream);
    if (screenShot) {
      setTempScreenshot(`data:${screenShot.mimeType};base64,${screenShot.data}`);
      setIsCropping(true);
      setCropRect(null);
    }
  };

  const cancelCrop = () => {
    setIsCropping(false);
    setTempScreenshot(null);
    setCropRect(null);
    setOcrState('idle');
  };

  const handleCropMouseDown = (e: React.MouseEvent) => {
    if (!isCropping || ocrState !== 'idle') return; 
    e.preventDefault();
    setIsDrawingCrop(true);
    const bounds = overlayRef.current?.getBoundingClientRect();
    if (!bounds) return;
    
    const x = e.clientX - bounds.left;
    const y = e.clientY - bounds.top;
    setCropStart({ x, y });
    setCropRect({ x, y, w: 0, h: 0 });
  };

  const handleCropMouseMove = (e: React.MouseEvent) => {
    if (!isDrawingCrop || !cropStart) return;
    const bounds = overlayRef.current?.getBoundingClientRect();
    if (!bounds) return;

    const currentX = e.clientX - bounds.left;
    const currentY = e.clientY - bounds.top;

    const x = Math.min(currentX, cropStart.x);
    const y = Math.min(currentY, cropStart.y);
    const w = Math.abs(currentX - cropStart.x);
    const h = Math.abs(currentY - cropStart.y);

    setCropRect({ x, y, w, h });
  };

  const handleCropMouseUp = () => {
    setIsDrawingCrop(false);
  };

  const processCrop = async (mode: 'attach' | 'ocr') => {
    if (!tempScreenshot || !cropRect || cropRect.w < 10 || cropRect.h < 10) return;

    const img = new Image();
    img.src = tempScreenshot;
    await new Promise(r => img.onload = r);

    const canvas = document.createElement('canvas');
    
    const containerW = overlayRef.current?.clientWidth || window.innerWidth;
    const containerH = overlayRef.current?.clientHeight || window.innerHeight;
    
    const imgRatio = img.width / img.height;
    const containerRatio = containerW / containerH;
    
    let renderW, renderH, offsetX, offsetY;
    
    if (containerRatio > imgRatio) {
       renderH = containerH;
       renderW = renderH * imgRatio;
       offsetX = (containerW - renderW) / 2;
       offsetY = 0;
    } else {
       renderW = containerW;
       renderH = renderW / imgRatio;
       offsetX = 0;
       offsetY = (containerH - renderH) / 2;
    }

    const scaleX = img.width / renderW;
    const scaleY = img.height / renderH;

    const actualX = (cropRect.x - offsetX) * scaleX;
    const actualY = (cropRect.y - offsetY) * scaleY;
    const actualW = cropRect.w * scaleX;
    const actualH = cropRect.h * scaleY;

    canvas.width = actualW;
    canvas.height = actualH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(img, actualX, actualY, actualW, actualH, 0, 0, actualW, actualH);
    
    const croppedBase64 = canvas.toDataURL('image/jpeg').split(',')[1];

    if (mode === 'attach') {
      setAttachedImage({ data: croppedBase64, mimeType: 'image/jpeg' });
      cancelCrop();
    } else if (mode === 'ocr') {
      setOcrState('scanning');
      try {
        const text = await extractTextFromImage(croppedBase64);
        setInputText(prev => {
          const trimmed = prev.trim();
          return trimmed ? `${trimmed}\n${text}` : text;
        });
        setOcrState('success');
        setInputHighlight(true);
        setTimeout(() => {
          cancelCrop();
          if (inputRef.current) inputRef.current.focus();
        }, 1200);
      } catch (e) {
        console.error(e);
        setOcrState('error');
        setTimeout(() => setOcrState('idle'), 2000);
      }
    }
  };

  // 2. Audio Recording (STT)
  const toggleRecording = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream);
        audioChunksRef.current = [];
        
        mediaRecorder.ondataavailable = (event) => {
          audioChunksRef.current.push(event.data);
        };

        mediaRecorder.onstop = async () => {
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
          stream.getTracks().forEach(track => track.stop()); 
          
          const reader = new FileReader();
          reader.readAsDataURL(audioBlob);
          reader.onloadend = async () => {
            const base64data = (reader.result as string).split(',')[1];
            setChatState(prev => ({ ...prev, isLoading: true }));
            try {
               const text = await transcribeAudio(base64data);
               setInputText(prev => (prev + " " + text).trim());
            } catch (e) {
               console.error("Transcription failed", e);
            } finally {
               setChatState(prev => ({ ...prev, isLoading: false }));
               inputRef.current?.focus();
            }
          };
        };

        mediaRecorder.start();
        mediaRecorderRef.current = mediaRecorder;
        setIsRecording(true);
      } catch (e) {
        console.error("Mic access denied", e);
      }
    }
  };

  // 3. Messaging Logic
  const handleSendMessage = async () => {
    if (!isOnline) return; // Prevent sending if offline
    if (!inputText.trim() && !mediaStream && !attachedImage) return;
    if (chatState.isLoading) return;

    const currentText = inputText.trim();
    let screenshot: ScreenshotData | null = attachedImage;

    if (!screenshot && isScreenShared) {
      screenshot = await captureFrame();
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      text: currentText + (screenshot ? (attachedImage ? " [Region Image]" : " [Screen Context]") : ""),
      timestamp: Date.now()
    };

    setChatState(prev => ({
      ...prev,
      messages: [...prev.messages, userMessage],
      isLoading: true,
      error: null
    }));
    setInputText('');
    setAttachedImage(null);

    const history: Content[] = chatState.messages.map(msg => ({
      role: msg.role,
      parts: [{ text: msg.text }]
    }));
    
    const session = createChatSession(
      {
        model: chatState.config.model,
        temperature: chatState.config.temperature,
        systemInstruction: chatState.config.systemInstruction,
        useThinking: chatState.config.useThinking,
        useSearch: chatState.config.useSearch,
        useMaps: chatState.config.useMaps
      },
      history
    );

    const botMessageId = (Date.now() + 1).toString();
    setChatState(prev => ({
      ...prev,
      messages: [...prev.messages, {
        id: botMessageId,
        role: 'model',
        text: '',
        isStreaming: true,
        timestamp: Date.now()
      }]
    }));

    try {
      let fullResponse = '';
      await sendMessageStream(
        session,
        currentText || (screenshot ? "Analyze this." : "Hello."),
        screenshot,
        (chunk) => {
          fullResponse += chunk;
          setChatState(prev => ({
            ...prev,
            messages: prev.messages.map(msg => 
              msg.id === botMessageId 
              ? { ...msg, text: fullResponse } 
              : msg
            )
          }));
          scrollToBottom();
        }
      );

      setChatState(prev => ({
        ...prev,
        isLoading: false,
        messages: prev.messages.map(msg => 
          msg.id === botMessageId ? { ...msg, isStreaming: false } : msg
        )
      }));

      chatSessionRef.current = session;

    } catch (error) {
      setChatState(prev => ({
        ...prev,
        isLoading: false,
        error: "Failed to generate response.",
        messages: prev.messages.filter(msg => msg.id !== botMessageId)
      }));
    }
  };

  // --- Drag Logic ---
  const handleMouseDown = (e: React.MouseEvent) => {
    if (isPiP || isCropping) return;
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('.no-drag')) return;
    if (overlayRef.current) {
      const rect = overlayRef.current.getBoundingClientRect();
      const currentX = position ? position.x : rect.left;
      const currentY = position ? position.y : rect.top;
      if (!position) setPosition({ x: currentX, y: currentY });
      dragOffsetRef.current = { x: e.clientX - currentX, y: e.clientY - currentY };
      setIsDragging(true);
    }
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging && !isPiP && !isCropping) {
        e.preventDefault();
        
        let newX = e.clientX - dragOffsetRef.current.x;
        let newY = e.clientY - dragOffsetRef.current.y;

        // --- BOUNDARY CONSTRAINTS ---
        // 1. Top Edge: Prevent header from disappearing above the screen (Keep Y >= 0)
        if (newY < 0) newY = 0;
        
        // 2. Bottom Edge: Keep at least the header visible (approx 60px from bottom)
        const windowHeight = window.innerHeight;
        if (newY > windowHeight - 60) newY = windowHeight - 60;

        // 3. Horizontal Edges: Keep largely on screen
        const windowWidth = window.innerWidth;
        if (newX < -300) newX = -300; 
        if (newX > windowWidth - 50) newX = windowWidth - 50;

        setPosition({
          x: newX,
          y: newY
        });
      }
    };
    const handleMouseUp = () => setIsDragging(false);
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, isPiP, isCropping]);

  // --- Resize Logic ---
  const handleResizeMouseDown = (e: React.MouseEvent, direction: string) => {
    e.stopPropagation();
    e.preventDefault();
    if (!overlayRef.current) return;
    const rect = overlayRef.current.getBoundingClientRect();
    
    // Initialize position if it's not set (centered state) to prevent jumping
    const currentX = position ? position.x : rect.left;
    const currentY = position ? position.y : rect.top;
    if (!position) {
        setPosition({ x: currentX, y: currentY });
    }

    resizeStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      w: rect.width,
      h: rect.height,
      posX: currentX,
      posY: currentY
    };
    setResizeDirection(direction);
    setIsResizing(true);
  };

  useEffect(() => {
    const handleResizeMove = (e: MouseEvent) => {
      if (!isResizing || !resizeStartRef.current || !resizeDirection) return;
      
      const { x: startX, y: startY, w: startW, h: startH, posX: startPosX, posY: startPosY } = resizeStartRef.current;
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;
      
      let newW = startW;
      let newH = startH;
      let newX = startPosX;
      let newY = startPosY;

      const MIN_W = 350;
      const MIN_H = 400;

      // Calculate new dimensions and position based on direction
      if (resizeDirection.includes('e')) {
        newW = Math.max(MIN_W, startW + deltaX);
      }
      if (resizeDirection.includes('s')) {
        newH = Math.max(MIN_H, startH + deltaY);
      }
      if (resizeDirection.includes('w')) {
        const proposedW = startW - deltaX;
        if (proposedW >= MIN_W) {
           newW = proposedW;
           newX = startPosX + deltaX;
        }
      }
      if (resizeDirection.includes('n')) {
        const proposedH = startH - deltaY;
        if (proposedH >= MIN_H) {
           newH = proposedH;
           newY = startPosY + deltaY;
        }
      }
      
      setSize({ width: newW, height: newH });
      
      // Only update position if we are resizing from Top or Left
      if (resizeDirection.includes('w') || resizeDirection.includes('n')) {
         setPosition({ x: newX, y: newY });
      }
    };

    const handleResizeUp = () => {
      setIsResizing(false);
      setResizeDirection(null);
    };

    if (isResizing) {
      window.addEventListener('mousemove', handleResizeMove);
      window.addEventListener('mouseup', handleResizeUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleResizeMove);
      window.removeEventListener('mouseup', handleResizeUp);
    };
  }, [isResizing, resizeDirection]);

  // --- PiP Logic (Multi-Screen Support) ---
  const togglePiP = async () => {
    if (isPiP && pipWindowRef.current) {
      pipWindowRef.current.close();
      return;
    }
    if (!('documentPictureInPicture' in window)) {
      alert("Feature not supported in this browser. Use Chrome or Edge.");
      return;
    }
    try {
      // Request a new window
      const pipWindow = await (window as any).documentPictureInPicture.requestWindow({
        width: 500, 
        height: 700,
      });
      pipWindowRef.current = pipWindow;
      
      // Copy styles to ensure the new window looks identical
      [...document.styleSheets].forEach((styleSheet) => {
        try {
          if (styleSheet.href) {
            const link = pipWindow.document.createElement('link');
            link.rel = 'stylesheet';
            link.type = 'text/css';
            link.href = styleSheet.href;
            pipWindow.document.head.appendChild(link);
          } else if (styleSheet.cssRules) {
            const newStyle = pipWindow.document.createElement('style');
            [...styleSheet.cssRules].forEach(rule => {
              newStyle.appendChild(pipWindow.document.createTextNode(rule.cssText));
            });
            pipWindow.document.head.appendChild(newStyle);
          }
        } catch (e) { console.error(e); }
      });

      // Copy Scripts (specifically for Tailwind CDN if used)
      const scripts = document.querySelectorAll('script');
      scripts.forEach(script => {
          if (script.src && script.src.includes('tailwindcss')) {
               const newScript = pipWindow.document.createElement('script');
               newScript.src = script.src; 
               pipWindow.document.head.appendChild(newScript);
          }
      });

      pipWindow.document.body.className = "bg-black text-white overflow-hidden h-screen w-screen flex flex-col";
      
      // Handle window closing logic
      pipWindow.addEventListener('pagehide', () => { 
          setIsPiP(false); 
          pipWindowRef.current = null; 
          setIsOpen(true); 
      });
      
      setIsPiP(true);
    } catch (err) { console.error("PiP failed", err); }
  };

  // --- Rendering ---

  if (!isOpen && !isPiP) {
     return (
      <button 
        onClick={() => setIsOpen(true)}
        className={`fixed bottom-8 right-8 p-4 bg-black/40 hover:bg-black/60 backdrop-blur-xl border border-white/20 rounded-full shadow-[0_0_20px_rgba(0,0,0,0.5)] text-white transition-all duration-500 hover:scale-110 group z-50 ${!isVisible ? 'opacity-0 pointer-events-none translate-y-10' : 'opacity-100 translate-y-0'}`}
      >
        <Sparkles className="w-6 h-6 group-hover:text-emerald-400 transition-colors animate-pulse" />
      </button>
    );
  }

  // Calculate main container styles
  const containerStyle: React.CSSProperties = isPiP 
    ? { width: '100%', height: '100vh', borderRadius: 0, border: 'none' }
    : isCropping
      ? { inset: 0, width: '100%', height: '100%', transform: 'none', borderRadius: 0 }
      : {
          left: position ? `${position.x}px` : '50%',
          top: position ? `${position.y}px` : '50%',
          transform: position ? 'none' : 'translate(-50%, -50%)',
          // If minimized, ignore custom size and let CSS classes handle dimensions, or use 'auto' to wrap content
          width: isMinimized ? 'auto' : (size.width || undefined),
          height: isMinimized ? 'auto' : (size.height || undefined)
        };

  const stealthClasses = isStealth 
    ? 'bg-black/5 backdrop-blur-[2px] border-white/5 shadow-none opacity-10 hover:opacity-100 hover:bg-black/80 hover:backdrop-blur-2xl hover:shadow-2xl hover:border-white/20' 
    : 'bg-gray-950/30 backdrop-blur-3xl border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.5)]';
  
  const croppingClasses = isCropping ? 'bg-black/80 cursor-crosshair' : stealthClasses;
  
  const visibilityClasses = isVisible 
    ? 'opacity-100 scale-100 pointer-events-auto' 
    : 'opacity-0 scale-95 pointer-events-none';

  const content = (
    <div 
      ref={overlayRef}
      style={containerStyle}
      className={`${isPiP ? 'relative h-full w-full' : 'fixed'} 
        ${isPiP || isCropping ? '' : isMinimized ? 'w-[380px] h-[64px]' : (!size.width ? 'w-[90vw] h-[80vh] md:w-[500px] md:h-[700px]' : '')} 
        ${isPiP ? 'bg-black' : croppingClasses} 
        ${visibilityClasses}
        border z-50 flex flex-col ${isCropping ? '' : isPiP ? '' : 'rounded-[32px]'} overflow-hidden transition-all duration-500 ease-out group/overlay`}
      onMouseDown={isCropping ? handleCropMouseDown : undefined}
      onMouseMove={isCropping ? handleCropMouseMove : undefined}
      onMouseUp={isCropping ? handleCropMouseUp : undefined}
    >
      <style>{`
        @keyframes scan {
          0% { top: 0%; opacity: 0; }
          15% { opacity: 1; }
          85% { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
      `}</style>

      {/* --- Offline Mode Banner --- */}
      {!isOnline && (
        <div className="absolute top-16 inset-x-4 z-50 bg-red-900/90 border border-red-500/50 rounded-xl p-4 backdrop-blur-xl shadow-2xl animate-fade-in">
          <div className="flex items-center gap-3 text-white">
            <div className="p-2 bg-red-500/20 rounded-full">
              <WifiOff size={24} className="text-red-200" />
            </div>
            <div>
              <h3 className="font-bold text-sm">Internet Disconnected</h3>
              <p className="text-xs text-white/70 mt-0.5">Offline Mode Active. Please reconnect to resume AI features.</p>
            </div>
          </div>
        </div>
      )}

      {/* --- Resize Handles --- */}
      {!isPiP && !isMinimized && !isCropping && (
         <>
            {/* Edges */}
            <div onMouseDown={(e) => handleResizeMouseDown(e, 'n')} className="absolute top-0 inset-x-4 h-2 cursor-ns-resize z-50 hover:bg-white/20 transition-colors rounded-full" />
            <div onMouseDown={(e) => handleResizeMouseDown(e, 's')} className="absolute bottom-0 inset-x-4 h-2 cursor-ns-resize z-50 hover:bg-white/20 transition-colors rounded-full" />
            <div onMouseDown={(e) => handleResizeMouseDown(e, 'w')} className="absolute inset-y-4 left-0 w-2 cursor-ew-resize z-50 hover:bg-white/20 transition-colors rounded-full" />
            <div onMouseDown={(e) => handleResizeMouseDown(e, 'e')} className="absolute inset-y-4 right-0 w-2 cursor-ew-resize z-50 hover:bg-white/20 transition-colors rounded-full" />
            
            {/* Corners */}
            <div onMouseDown={(e) => handleResizeMouseDown(e, 'nw')} className="absolute top-0 left-0 w-6 h-6 cursor-nwse-resize z-50 hover:bg-white/20 rounded-tl-[32px]" />
            <div onMouseDown={(e) => handleResizeMouseDown(e, 'ne')} className="absolute top-0 right-0 w-6 h-6 cursor-nesw-resize z-50 hover:bg-white/20 rounded-tr-[32px]" />
            <div onMouseDown={(e) => handleResizeMouseDown(e, 'sw')} className="absolute bottom-0 left-0 w-6 h-6 cursor-nesw-resize z-50 hover:bg-white/20 rounded-bl-[32px]" />
            <div onMouseDown={(e) => handleResizeMouseDown(e, 'se')} className="absolute bottom-0 right-0 w-6 h-6 cursor-nwse-resize z-50 hover:bg-white/20 rounded-br-[32px]" />
         </>
      )}
      
      {/* --- Cropping UI Layer --- */}
      {isCropping && tempScreenshot && (
        <div className="absolute inset-0 z-50 flex flex-col animate-fade-in">
          <img 
            src={tempScreenshot} 
            alt="Screen Capture" 
            className="absolute inset-0 w-full h-full object-contain opacity-60 pointer-events-none select-none"
          />
          
          {cropRect && (
             <div 
              className={`absolute border-2 transition-colors duration-300
                ${ocrState === 'success' ? 'border-emerald-500 bg-emerald-500/10' : 
                  ocrState === 'scanning' ? 'border-indigo-400 bg-indigo-400/10' : 
                  ocrState === 'error' ? 'border-red-500 bg-red-500/10' :
                  'border-red-500 bg-white/10'} 
                backdrop-contrast-125 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)] pointer-events-none`}
              style={{
                left: cropRect.x,
                top: cropRect.y,
                width: cropRect.w,
                height: cropRect.h
              }}
             >
                {ocrState === 'scanning' && (
                  <div className="absolute inset-x-0 h-0.5 bg-indigo-400 shadow-[0_0_15px_rgba(129,140,248,1)] animate-[scan_1.5s_linear_infinite]" />
                )}
                {ocrState === 'success' && (
                   <div className="absolute inset-0 flex items-center justify-center animate-fade-in">
                      <div className="bg-emerald-500 text-white p-3 rounded-full shadow-lg scale-125">
                         <CheckCircle size={24} />
                      </div>
                   </div>
                )}
                {ocrState === 'error' && (
                   <div className="absolute inset-0 flex items-center justify-center animate-fade-in">
                      <div className="bg-red-500 text-white px-3 py-1 rounded-lg text-sm font-bold shadow-lg">
                         Error
                      </div>
                   </div>
                )}
                {ocrState === 'idle' && (
                  <div className="absolute -top-6 left-0 bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-t font-bold">
                    {Math.round(cropRect.w)} x {Math.round(cropRect.h)}
                  </div>
                )}
             </div>
          )}

          <div className={`absolute bottom-10 left-1/2 -translate-x-1/2 flex items-center gap-4 bg-gray-900 p-2 rounded-full border border-white/20 shadow-2xl pointer-events-auto animate-fade-in-up transition-opacity duration-300 ${ocrState !== 'idle' ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
             <button 
               onClick={cancelCrop}
               className="p-3 hover:bg-white/10 rounded-full text-white/60 hover:text-white transition-colors"
               title="Cancel"
             >
               <X size={20} />
             </button>
             <div className="w-px h-8 bg-white/10" />
             <button 
               onClick={() => processCrop('attach')}
               disabled={!cropRect || cropRect.w < 10}
               className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:hover:bg-emerald-600 rounded-full text-white font-medium transition-colors"
             >
               <ImageIcon size={16} />
               <span>Use Image</span>
             </button>
             <button 
               onClick={() => processCrop('ocr')}
               disabled={!cropRect || cropRect.w < 10}
               className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-600 rounded-full text-white font-medium transition-colors"
             >
               <ScanLine size={16} />
               <span>Scan Text</span>
             </button>
          </div>
        </div>
      )}

      {/* --- Header --- */}
      {!isCropping && (
      <div 
        className={`relative flex-none flex items-center justify-between px-5 py-4 select-none group/header ${!isPiP ? 'cursor-grab active:cursor-grabbing' : ''} transition-colors duration-300 ${isDragging ? 'bg-white/10 border-b border-white/10' : 'bg-gradient-to-b from-white/5 to-transparent'}`}
        onMouseDown={handleMouseDown}
        onDoubleClick={() => !isPiP && setIsMinimized(!isMinimized)}
      >
         <div className="flex items-center gap-3 no-drag">
          {!isPiP && (
            <>
              <button onClick={() => setIsOpen(false)} className="w-3 h-3 rounded-full bg-red-500/80 hover:bg-red-500 transition-colors shadow-inner group relative"><span className="absolute inset-0 hidden group-hover:flex items-center justify-center text-[8px] text-black font-bold">✕</span></button>
              <button onClick={() => setIsMinimized(!isMinimized)} className="w-3 h-3 rounded-full bg-yellow-500/80 hover:bg-yellow-500 transition-colors shadow-inner" />
            </>
          )}
          {isPiP && <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />}
        </div>

        <div className="flex items-center gap-3 pointer-events-none">
          {!isPiP && !isMinimized && (
             <div className={`flex flex-col gap-0.5 p-1 rounded-md transition-opacity duration-300 ${isDragging ? 'opacity-100' : 'opacity-30 group-hover/header:opacity-70'}`}>
                <GripHorizontal size={16} className="text-white" />
             </div>
          )}

          <div className="flex items-center gap-2">
            <div className="relative">
              <div className={`absolute inset-0 blur-sm bg-emerald-500/30 rounded-full ${isStealth ? 'opacity-0 group-hover/overlay:opacity-100' : ''}`} />
              <Sparkles className={`w-4 h-4 text-emerald-400 relative z-10 ${isStealth ? 'opacity-50 group-hover/overlay:opacity-100' : ''}`} />
            </div>
            <span className={`text-sm font-medium tracking-wide drop-shadow-md ${isStealth ? 'text-white/30 group-hover/overlay:text-white/90' : 'text-white/90'}`}>Gemini</span>
          </div>
        </div>

        <div className="flex items-center gap-1 text-white/50 no-drag">
          <button onClick={() => setIsStealth(!isStealth)} className={`p-1.5 hover:bg-white/10 rounded-full transition-colors ${isStealth ? 'text-indigo-400' : ''}`} title="Toggle Stealth Mode (Alt+S)">
            {isStealth ? <Ghost size={14} /> : <Eye size={14} />}
          </button>
          
          {/* History Toggle */}
          <button 
            onClick={() => { setShowHistory(!showHistory); setShowSettings(false); }} 
            className={`p-1.5 hover:bg-white/10 rounded-full transition-colors ${showHistory ? 'text-white bg-white/10' : ''}`} 
            title="Chat History"
          >
            <History size={14} />
          </button>

          {/* Settings Toggle */}
          <button 
            onClick={() => { setShowSettings(!showSettings); setShowHistory(false); }} 
            className={`p-1.5 hover:bg-white/10 rounded-full transition-colors ${showSettings ? 'text-white bg-white/10' : ''}`} 
            title="Settings"
          >
            <Settings size={14} />
          </button>

          <button onClick={togglePiP} className={`p-1.5 hover:bg-white/10 rounded-full transition-colors ${isPiP ? 'text-emerald-400' : ''}`} title="Pop Out (Move to Window)"><ExternalLink size={14} /></button>
          <button onClick={() => setChatState(prev => ({ ...prev, messages: [] }))} className="p-1.5 hover:bg-white/10 rounded-full transition-colors" title="Clear Chat"><RefreshCw size={14} /></button>
          {!isPiP && (
             <button onClick={() => setIsMinimized(!isMinimized)} className="p-1.5 hover:bg-white/10 hover:text-white rounded-full transition-colors">
              {isMinimized ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
            </button>
           )}
        </div>
      </div>
      )}

      {/* --- Toolbar --- */}
      {!isMinimized && !showSettings && !showHistory && !isCropping && (
        <div className={`flex-none px-4 py-2 flex items-center gap-2 bg-white/5 border-b border-white/5 backdrop-blur-sm overflow-x-auto scrollbar-hide transition-opacity duration-300 ${isStealth ? 'opacity-0 group-hover/overlay:opacity-100' : 'opacity-100'}`}>
           <button
            onClick={() => setChatState(prev => ({...prev, config: {...prev.config, useThinking: !prev.config.useThinking}}))}
            className={`flex-none flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${chatState.config.useThinking ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'bg-white/5 text-white/40 border border-transparent hover:bg-white/10'}`}
           >
             <BrainCircuit size={12} />
             <span>Deep Think</span>
           </button>
           
           <button
            onClick={() => setChatState(prev => ({...prev, config: {...prev.config, useSearch: !prev.config.useSearch}}))}
            className={`flex-none flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${chatState.config.useSearch ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' : 'bg-white/5 text-white/40 border border-transparent hover:bg-white/10'}`}
           >
             <Globe size={12} />
             <span>Search</span>
           </button>

           <button
            onClick={() => toggleScreenShare()}
            className={`flex-none flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${isScreenShared ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 animate-pulse' : 'bg-white/5 text-white/40 border border-transparent hover:bg-white/10'}`}
           >
             {isScreenShared ? <Monitor size={12} /> : <Eye size={12} />}
             <span>{isScreenShared ? 'Watching' : 'Watch Screen'}</span>
           </button>

           <button
             onClick={startRegionCapture}
             className="flex-none flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all bg-white/5 text-white/40 border border-transparent hover:bg-white/10 hover:text-pink-300"
             title="Snipping Tool"
           >
             <Crop size={12} />
             <span>Crop & Ask</span>
           </button>
        </div>
      )}

      {/* --- History View --- */}
      {showHistory && !isMinimized && !isCropping && (
        <div className="flex-1 flex flex-col bg-gray-950/80 backdrop-blur-xl p-0 overflow-hidden animate-fade-in">
           <div className="flex-none flex items-center justify-between p-6 pb-4 text-white/90 border-b border-white/10 bg-white/5">
              <div className="flex items-center gap-3">
                <button onClick={() => setShowHistory(false)} className="p-2 rounded-full hover:bg-white/10 transition-colors"><ChevronLeft size={18}/></button>
                <div>
                  <h2 className="text-lg font-semibold tracking-tight">History</h2>
                  <p className="text-xs text-white/40">Saved conversations</p>
                </div>
              </div>
              <button 
                onClick={handleSaveSession}
                disabled={chatState.messages.length <= 1}
                className="flex items-center gap-2 px-3 py-1.5 bg-white/10 hover:bg-white/20 disabled:opacity-50 disabled:hover:bg-white/10 rounded-lg text-xs font-medium transition-colors"
              >
                <Archive size={14} />
                <span>Save Current</span>
              </button>
           </div>

           <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
             {sessions.length === 0 && (
                <div className="flex flex-col items-center justify-center h-40 text-white/30">
                   <History size={32} className="mb-2 opacity-50" />
                   <span className="text-sm">No saved sessions yet</span>
                </div>
             )}
             
             {sessions.map((session) => (
                <div key={session.id} className="group flex items-center justify-between p-4 bg-white/5 hover:bg-white/10 border border-white/5 rounded-xl transition-all">
                   <button onClick={() => handleLoadSession(session)} className="flex-1 text-left overflow-hidden">
                      <div className="font-medium text-sm text-white/90 truncate">{session.title}</div>
                      <div className="flex items-center gap-2 mt-1 text-xs text-white/40">
                         <Clock size={10} />
                         <span>{new Date(session.timestamp).toLocaleDateString()}</span>
                         <span>•</span>
                         <span>{new Date(session.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                         <span>•</span>
                         <span>{session.messages.length} msgs</span>
                      </div>
                   </button>
                   <button 
                     onClick={(e) => handleDeleteSession(e, session.id)} 
                     className="p-2 text-white/20 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                     title="Delete Session"
                   >
                      <Trash2 size={16} />
                   </button>
                </div>
             ))}
           </div>
        </div>
      )}

      {/* --- Settings View --- */}
      {showSettings && !isMinimized && !isCropping && (
        <div className="flex-1 flex flex-col bg-gray-950/80 backdrop-blur-xl p-0 overflow-hidden animate-fade-in">
           <div className="flex-none flex items-center gap-3 p-6 pb-4 text-white/90 border-b border-white/10 bg-white/5">
              <button onClick={() => setShowSettings(false)} className="p-2 rounded-full hover:bg-white/10 transition-colors"><ChevronLeft size={18}/></button>
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Settings</h2>
                <p className="text-xs text-white/40">Customize your AI experience</p>
              </div>
           </div>

           <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
             
             {/* Section 1: Intelligence & Model */}
             <SettingsSection 
                id="model" 
                title="Intelligence & Model" 
                icon={Cpu}
                activeSection={activeSettingsSection}
                onToggle={setActiveSettingsSection}
             >
               <div className="grid gap-3">
                  {/* Flash */}
                  <button 
                    onClick={() => setChatState(prev => ({...prev, config: {...prev.config, model: ModelType.FLASH}}))}
                    className={`group flex items-center justify-between p-4 rounded-xl border transition-all ${chatState.config.model === ModelType.FLASH ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400' : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'}`}
                  >
                     <div className="text-left">
                       <div className="font-medium text-sm flex items-center gap-2">
                         Gemini 2.5 Flash
                         {chatState.config.model === ModelType.FLASH && <Check size={14} />}
                       </div>
                       <div className="text-xs opacity-60 mt-1">Fast, efficient, and lightweight. Best for quick tasks.</div>
                     </div>
                  </button>

                  {/* Pro */}
                  <button 
                    onClick={() => setChatState(prev => ({...prev, config: {...prev.config, model: ModelType.PRO}}))}
                    className={`group flex items-center justify-between p-4 rounded-xl border transition-all ${chatState.config.model === ModelType.PRO ? 'bg-indigo-500/10 border-indigo-500/50 text-indigo-400' : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'}`}
                  >
                     <div className="text-left">
                       <div className="font-medium text-sm flex items-center gap-2">
                         Gemini 3 Pro Preview
                         {chatState.config.model === ModelType.PRO && <Check size={14} />}
                       </div>
                       <div className="text-xs opacity-60 mt-1">Advanced reasoning for complex problems and coding.</div>
                     </div>
                  </button>
                  
                  {/* Deep Think Toggle */}
                  <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5">
                     <div className="flex items-center gap-3">
                        <div className="p-2 bg-indigo-500/20 rounded-lg text-indigo-300"><BrainCircuit size={16}/></div>
                        <div className="flex flex-col">
                           <span className="text-sm font-medium text-white/80">Deep Think</span>
                           <span className="text-[10px] text-white/40">Enable extended reasoning time</span>
                        </div>
                     </div>
                     <button 
                       onClick={() => setChatState(prev => ({...prev, config: {...prev.config, useThinking: !prev.config.useThinking}}))}
                       className={`w-10 h-5 rounded-full transition-colors relative ${chatState.config.useThinking ? 'bg-indigo-500' : 'bg-white/10'}`}
                     >
                        <div className={`absolute top-1 bottom-1 w-3 h-3 bg-white rounded-full transition-transform duration-300 ${chatState.config.useThinking ? 'left-6' : 'left-1'}`} />
                     </button>
                  </div>
               </div>
             </SettingsSection>

             {/* Section 2: Tools & Capabilities */}
             <SettingsSection 
                id="tools" 
                title="Tools & Capabilities" 
                icon={Wrench}
                activeSection={activeSettingsSection}
                onToggle={setActiveSettingsSection}
             >
                <div className="grid grid-cols-2 gap-3">
                    <button 
                      onClick={() => setChatState(prev => ({...prev, config: {...prev.config, useSearch: !prev.config.useSearch}}))}
                      className={`relative overflow-hidden flex flex-col items-center gap-3 p-4 rounded-xl border transition-all ${chatState.config.useSearch ? 'bg-blue-500/10 border-blue-500/40 text-blue-400' : 'bg-white/5 border-white/10 text-white/40 hover:bg-white/10'}`}
                    >
                       <div className={`p-3 rounded-full transition-colors ${chatState.config.useSearch ? 'bg-blue-500/20' : 'bg-white/5'}`}>
                          <Globe size={20} />
                       </div>
                       <div className="text-center">
                         <div className="text-xs font-bold uppercase tracking-wider">Google Search</div>
                         <div className="text-[10px] opacity-60 mt-1">Access real-time web data</div>
                       </div>
                       {chatState.config.useSearch && <div className="absolute inset-x-0 bottom-0 h-0.5 bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,1)]" />}
                    </button>

                    <button 
                      onClick={() => setChatState(prev => ({...prev, config: {...prev.config, useMaps: !prev.config.useMaps}}))}
                      className={`relative overflow-hidden flex flex-col items-center gap-3 p-4 rounded-xl border transition-all ${chatState.config.useMaps ? 'bg-green-500/10 border-green-500/40 text-green-400' : 'bg-white/5 border-white/10 text-white/40 hover:bg-white/10'}`}
                    >
                       <div className={`p-3 rounded-full transition-colors ${chatState.config.useMaps ? 'bg-green-500/20' : 'bg-white/5'}`}>
                          <MapPin size={20} />
                       </div>
                       <div className="text-center">
                         <div className="text-xs font-bold uppercase tracking-wider">Google Maps</div>
                         <div className="text-[10px] opacity-60 mt-1">Location & place data</div>
                       </div>
                       {chatState.config.useMaps && <div className="absolute inset-x-0 bottom-0 h-0.5 bg-green-500 shadow-[0_0_10px_rgba(34,197,94,1)]" />}
                    </button>
                </div>
             </SettingsSection>

             {/* Section 3: Persona & Creativity */}
             <SettingsSection 
                id="creativity" 
                title="Personality & Creativity" 
                icon={Palette}
                activeSection={activeSettingsSection}
                onToggle={setActiveSettingsSection}
             >
                <div className="space-y-6">
                   {/* Temperature */}
                   <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2 text-xs font-medium text-white/60 uppercase tracking-wider">
                           <Sliders size={12} />
                           Temperature
                        </div>
                        <span className="text-xs font-mono bg-white/10 px-2 py-0.5 rounded text-white/80">{chatState.config.temperature.toFixed(1)}</span>
                      </div>
                      <div className="relative h-6 flex items-center">
                        <input 
                          type="range" 
                          min="0" 
                          max="2" 
                          step="0.1"
                          value={chatState.config.temperature}
                          onChange={(e) => setChatState(prev => ({...prev, config: {...prev.config, temperature: parseFloat(e.target.value)}}))}
                          className="absolute w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-emerald-500 z-10"
                        />
                        <div className="absolute inset-x-0 h-1.5 rounded-full overflow-hidden pointer-events-none">
                           <div className="h-full bg-gradient-to-r from-blue-500 via-emerald-500 to-orange-500 opacity-30" />
                        </div>
                      </div>
                      <div className="flex justify-between text-[9px] text-white/30 uppercase font-bold tracking-widest">
                        <span>Precise</span>
                        <span>Balanced</span>
                        <span>Creative</span>
                      </div>
                   </div>

                   {/* System Instructions */}
                   <div className="space-y-2">
                     <div className="flex items-center gap-2 text-xs font-medium text-white/60 uppercase tracking-wider">
                        <MessageSquare size={12} />
                        System Persona
                     </div>
                     <textarea 
                       value={chatState.config.systemInstruction}
                       onChange={(e) => setChatState(prev => ({...prev, config: {...prev.config, systemInstruction: e.target.value}}))}
                       className="w-full h-32 bg-black/20 border border-white/10 rounded-xl p-3 text-sm text-white/80 focus:border-emerald-500/50 focus:bg-black/40 outline-none resize-none custom-scrollbar transition-all"
                       placeholder="You are a helpful assistant..."
                     />
                     <p className="text-[10px] text-white/30">Define how the AI should behave, its tone, and its specific role.</p>
                   </div>
                </div>
             </SettingsSection>
           </div>
        </div>
      )}

      {/* --- Chat Area --- */}
      <div className={`flex-1 flex flex-col overflow-hidden transition-opacity duration-300 ${isMinimized && !isPiP ? 'opacity-0' : 'opacity-100'} ${(isMinimized && !isPiP) || showSettings || showHistory || isCropping ? 'hidden' : 'flex'}`}>
        <div className={`flex-1 overflow-y-auto p-4 md:p-5 space-y-4 md:space-y-6 custom-scrollbar scroll-smooth ${isStealth ? 'opacity-20 group-hover/overlay:opacity-100 transition-opacity duration-500' : ''}`}>
          {chatState.messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
          {chatState.error && (
            <div className="p-3 mx-auto max-w-[80%] text-center text-xs text-red-200 bg-red-500/20 border border-red-500/30 rounded-xl backdrop-blur-md">
              {chatState.error}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* --- Input Area --- */}
        <div className={`flex-none p-4 bg-gradient-to-t from-black/40 to-transparent pt-4 transition-opacity duration-300 ${isStealth ? 'opacity-0 group-hover/overlay:opacity-100' : 'opacity-100'}`}>
           
           {/* Attached Image Preview */}
           {attachedImage && (
             <div className="mb-3 flex items-center gap-3 bg-white/10 rounded-lg p-2 w-fit backdrop-blur-md border border-white/10 animate-fade-in-up">
               <img src={`data:${attachedImage.mimeType};base64,${attachedImage.data}`} alt="Attached" className="h-12 rounded-md" />
               <div className="flex flex-col">
                 <span className="text-xs font-medium text-white/80">Region Capture</span>
                 <span className="text-[10px] text-white/40">Attached</span>
               </div>
               <button onClick={() => setAttachedImage(null)} className="ml-2 p-1 hover:bg-white/20 rounded-full text-white/60 hover:text-white"><X size={12}/></button>
             </div>
           )}

           <div className={`relative flex items-center gap-2 bg-gray-900/60 backdrop-blur-xl rounded-[24px] border transition-all duration-500 shadow-lg px-2 py-1 
             ${inputHighlight 
                ? 'border-emerald-500 shadow-[0_0_30px_rgba(16,185,129,0.3)] bg-emerald-950/30' 
                : 'border-white/10 focus-within:border-white/20 focus-within:bg-gray-900/80'} 
             ${!isOnline ? 'opacity-50 border-red-500/30' : ''}`}>
              
              {/* Mic Button */}
              <button 
                onClick={toggleRecording}
                disabled={!isOnline}
                className={`p-3 rounded-full transition-all ${isRecording ? 'bg-red-500 text-white animate-pulse' : 'text-white/50 hover:text-white hover:bg-white/10'} ${!isOnline ? 'opacity-30 cursor-not-allowed' : ''}`}
              >
                <Mic size={20} />
              </button>

              <input
                ref={inputRef}
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder={!isOnline ? "Waiting for connection..." : isRecording ? "Listening..." : isScreenShared ? "Ask about this..." : attachedImage ? "Ask about this region..." : "Type a message..."}
                className={`flex-1 bg-transparent text-white placeholder-white/30 px-2 py-3 outline-none font-light min-w-0 ${!isOnline ? 'cursor-not-allowed' : ''}`}
                disabled={chatState.isLoading || !isOnline}
              />

              <button
                onClick={handleSendMessage}
                disabled={(!inputText.trim() && !isScreenShared && !attachedImage) || chatState.isLoading || !isOnline}
                className={`p-3 rounded-[20px] transition-all duration-300 flex-shrink-0 ${
                   !isOnline 
                    ? 'bg-white/5 text-white/10 cursor-not-allowed'
                    : (inputText.trim() || isScreenShared || attachedImage) && !chatState.isLoading
                      ? 'bg-white text-black shadow-[0_0_20px_rgba(255,255,255,0.3)] hover:scale-105 active:scale-95'
                      : 'bg-white/5 text-white/20 cursor-not-allowed'
                }`}
              >
                 {chatState.isLoading ? <div className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full animate-spin" /> : !isOnline ? <CloudOff size={18} /> : <Send size={18} />}
              </button>
           </div>
           <div className="flex justify-between mt-3 px-3">
             <div className="flex items-center gap-2 text-[10px] text-white/30 uppercase tracking-wider font-medium">
                {chatState.config.useThinking ? <BrainCircuit size={10} className="text-indigo-400" /> : null}
                {chatState.config.useThinking 
                  ? 'Reasoning Active (Pro)' 
                  : chatState.config.model === ModelType.PRO 
                    ? 'Gemini 3 Pro' 
                    : 'Gemini Flash'}
             </div>
             <div className={`flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-medium ${isOnline ? 'text-emerald-500/50' : 'text-red-500/50'}`}>
                <div className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-red-500'} ${isOnline ? 'animate-pulse' : ''}`} />
                {isOnline ? 'Online' : 'Offline'}
             </div>
             
             {/* Add Resize Handle to bottom right of the UI area (inside the footer) */}
             {!isPiP && !isMinimized && !isCropping && (
                <div 
                  className="absolute bottom-2 right-2 w-4 h-4 cursor-se-resize flex items-end justify-end opacity-30 hover:opacity-100 transition-opacity"
                  onMouseDown={(e) => handleResizeMouseDown(e, 'se')}
                >
                   <svg viewBox="0 0 10 10" className="w-full h-full fill-current text-white">
                     <path d="M10 10 L0 10 L10 0 Z" />
                   </svg>
                </div>
             )}
           </div>
        </div>
      </div>
    </div>
  );

  if (isPiP && pipWindowRef.current) return createPortal(content, pipWindowRef.current.document.body);
  return content;
};