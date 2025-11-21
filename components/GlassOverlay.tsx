import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { 
  Send, Sparkles, RefreshCw, Minimize2, Maximize2, ExternalLink, 
  WifiOff, Wifi, Eye, X, Mic, BrainCircuit, Globe, Monitor, GripHorizontal,
  Ghost, EyeOff
} from 'lucide-react';
import { Message, ChatState, ModelType } from '../types';
import { createChatSession, sendMessageStream, transcribeAudio } from '../services/geminiService';
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

const STORAGE_KEY = 'gemini_glass_overlay_history_v2';

interface ScreenshotData {
  data: string; // base64
  mimeType: string;
}

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
          return {
            messages: parsed.messages || [],
            isLoading: false,
            error: null,
            config: parsed.config || { useSearch: false, useThinking: false, isScreenActive: false }
          };
        } catch (e) { console.error(e); }
      }
    }
    return {
      messages: [{
        id: 'welcome',
        role: 'model',
        text: "I am your advanced AI overlay. I can see your screen, browse the web, and think deeply about complex problems.",
        timestamp: Date.now()
      }],
      isLoading: false,
      error: null,
      config: { useSearch: false, useThinking: false, isScreenActive: false }
    };
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
      // Alt + H to toggle visibility (Ghost Mode)
      if (e.altKey && (e.key === 'h' || e.key === 'H')) {
        setIsVisible(prev => !prev);
      }
      // Alt + S to toggle stealth (Transparency)
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

  // Persist to LocalStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      messages: chatState.messages,
      config: chatState.config
    }));
  }, [chatState.messages, chatState.config]);

  // Initialize Chat (Re-create if config changes)
  const initializeChat = useCallback(() => {
    const history: Content[] = chatState.messages.map(msg => ({
      role: msg.role,
      parts: [{ text: msg.text }]
    }));
    
    // Determine model: Pro if thinking is on, otherwise Flash
    // We will dynamically switch to Pro for Vision in handleSendMessage if needed
    const model = chatState.config.useThinking ? ModelType.PRO : ModelType.FLASH;
    
    chatSessionRef.current = createChatSession(
      model,
      undefined,
      history,
      chatState.config.useThinking,
      chatState.config.useSearch
    );
  }, [chatState.messages, chatState.config.useThinking, chatState.config.useSearch]);

  // Initial Load
  useEffect(() => {
    initializeChat();
  }, []); // Run once on mount

  // Scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };
  useEffect(() => {
    if (!isMinimized && isVisible) scrollToBottom();
  }, [chatState.messages, isOpen, isMinimized, isPiP, isVisible]);

  // --- Features ---

  // 1. Screen Sharing (Vision)
  const toggleScreenShare = async () => {
    if (isScreenShared) {
      // Stop sharing
      mediaStream?.getTracks().forEach(track => track.stop());
      setMediaStream(null);
      setIsScreenShared(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { cursor: "always" } as any,
          audio: false
        });
        
        stream.getVideoTracks()[0].onended = () => {
          setIsScreenShared(false);
          setMediaStream(null);
        };

        setMediaStream(stream);
        setIsScreenShared(true);
      } catch (err) {
        console.error("Screen share cancelled", err);
      }
    }
  };

  const captureFrame = async (): Promise<ScreenshotData | null> => {
    if (!mediaStream) return null;
    
    // Smart Capture: Briefly hide the overlay so we don't block the content
    const wasVisible = isVisible;
    if (wasVisible && !isPiP) {
       setIsVisible(false);
       // Wait for render cycle to hide DOM
       await new Promise(resolve => setTimeout(resolve, 250));
    }

    try {
      const track = mediaStream.getVideoTracks()[0];
      const imageCapture = new ImageCapture(track);
      const bitmap = await imageCapture.grabFrame();
      
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      if (context) {
        context.drawImage(bitmap, 0, 0);
        const base64Url = canvas.toDataURL('image/jpeg', 0.8);
        
        // Restore visibility
        if (wasVisible && !isPiP) setIsVisible(true);
        
        return {
          data: base64Url.split(',')[1],
          mimeType: 'image/jpeg'
        };
      }
    } catch (e) {
      console.error("Capture failed", e);
      if (wasVisible && !isPiP) setIsVisible(true);
    }
    return null;
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
          stream.getTracks().forEach(track => track.stop()); // clean up mic
          
          // Convert blob to base64
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
    if (!inputText.trim() && !mediaStream) return;
    if (chatState.isLoading || !isOnline) return;

    const currentText = inputText.trim();
    
    // Capture screen if active
    let screenshot: ScreenshotData | null = null;
    if (isScreenShared) {
      screenshot = await captureFrame();
    }

    // If image attached, force use of PRO model (Gemini 3 Pro Preview) for vision
    // If text only, check config for Thinking or Default Flash
    let targetModel = chatState.config.useThinking ? ModelType.PRO : ModelType.FLASH;
    if (screenshot) {
      targetModel = ModelType.PRO;
    }

    // Create User Message
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      text: currentText + (screenshot ? " [Screen Context]" : ""),
      timestamp: Date.now()
    };

    setChatState(prev => ({
      ...prev,
      messages: [...prev.messages, userMessage],
      isLoading: true,
      error: null
    }));
    setInputText('');

    // Prepare Session
    // If the target model differs from the current session model (implied by config), recreate session
    // We always recreate here to ensure fresh config (like image support) is applied correctly
    const history: Content[] = chatState.messages.map(msg => ({
      role: msg.role,
      parts: [{ text: msg.text }]
    }));

    const session = createChatSession(
      targetModel,
      undefined, 
      history, 
      chatState.config.useThinking,
      chatState.config.useSearch
    );

    // Placeholder Bot Message
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
        currentText || (screenshot ? "Analyze this screen." : ""),
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

      // Update reference for next turn
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
    if (isPiP) return;
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
      if (isDragging && !isPiP) {
        e.preventDefault();
        setPosition({
          x: e.clientX - dragOffsetRef.current.x,
          y: e.clientY - dragOffsetRef.current.y
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
  }, [isDragging, isPiP]);

  // --- PiP Logic ---
  const togglePiP = async () => {
    if (isPiP && pipWindowRef.current) {
      pipWindowRef.current.close();
      return;
    }
    if (!('documentPictureInPicture' in window)) {
      alert("Feature not supported in this browser.");
      return;
    }
    try {
      const pipWindow = await (window as any).documentPictureInPicture.requestWindow({
        width: 450, height: 600,
      });
      pipWindowRef.current = pipWindow;
      
      // Style Sync
      [...document.styleSheets].forEach((styleSheet) => {
        try {
          if (styleSheet.href) {
            const link = pipWindow.document.createElement('link');
            link.rel = 'stylesheet'; link.href = styleSheet.href;
            pipWindow.document.head.appendChild(link);
          } else {
            const css = [...styleSheet.cssRules].map(r => r.cssText).join('');
            const style = pipWindow.document.createElement('style');
            style.textContent = css;
            pipWindow.document.head.appendChild(style);
          }
        } catch (e) {}
      });
      const scripts = document.querySelectorAll('script');
      scripts.forEach(script => {
          if (script.src.includes('tailwindcss')) {
               const newScript = pipWindow.document.createElement('script');
               newScript.src = script.src; pipWindow.document.head.appendChild(newScript);
          }
      });
      pipWindow.document.body.className = "bg-black text-white overflow-hidden";
      pipWindow.addEventListener('pagehide', () => { setIsPiP(false); pipWindowRef.current = null; setIsOpen(true); });
      setIsPiP(true);
    } catch (err) { console.error("PiP failed", err); }
  };

  // --- Rendering ---

  if (!isVisible) {
    // Global keyboard listener still active to toggle back
    return null;
  }

  if (!isOpen && !isPiP) {
    return (
      <button 
        onClick={() => setIsOpen(true)}
        className="fixed bottom-8 right-8 p-4 bg-black/40 hover:bg-black/60 backdrop-blur-xl border border-white/20 rounded-full shadow-[0_0_20px_rgba(0,0,0,0.5)] text-white transition-all duration-300 hover:scale-110 group z-50"
      >
        <Sparkles className="w-6 h-6 group-hover:text-emerald-400 transition-colors animate-pulse" />
      </button>
    );
  }

  const containerStyle: React.CSSProperties = isPiP 
    ? { width: '100%', height: '100vh', borderRadius: 0, border: 'none' }
    : position 
      ? { left: `${position.x}px`, top: `${position.y}px`, transform: 'none' }
      : {};

  // Dynamic styling based on Stealth Mode
  const stealthClasses = isStealth 
    ? 'bg-black/5 backdrop-blur-[2px] border-white/5 shadow-none opacity-10 hover:opacity-100 hover:bg-black/80 hover:backdrop-blur-2xl hover:shadow-2xl hover:border-white/20' 
    : 'bg-gray-950/30 backdrop-blur-3xl border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.5)]';

  const content = (
    <div 
      ref={overlayRef}
      style={containerStyle}
      className={`${isPiP ? 'relative' : 'fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2'} 
        ${isPiP ? '' : isMinimized ? 'w-[380px] h-[64px]' : 'w-[90vw] h-[80vh] md:w-[500px] md:h-[700px]'} 
        ${isPiP ? 'bg-black' : stealthClasses} 
        border z-50 flex flex-col rounded-[32px] overflow-hidden transition-all duration-500 ease-out group/overlay`}
    >
      {/* --- Header --- */}
      <div 
        className={`flex items-center justify-between px-5 py-4 select-none ${!isPiP && !isMinimized ? 'cursor-grab active:cursor-grabbing' : ''} bg-gradient-to-b from-white/5 to-transparent`}
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

        <div className="flex items-center gap-2 pointer-events-none">
          <div className="relative">
            <div className={`absolute inset-0 blur-sm bg-emerald-500/30 rounded-full ${isStealth ? 'opacity-0 group-hover/overlay:opacity-100' : ''}`} />
            <Sparkles className={`w-4 h-4 text-emerald-400 relative z-10 ${isStealth ? 'opacity-50 group-hover/overlay:opacity-100' : ''}`} />
          </div>
          <span className={`text-sm font-medium tracking-wide drop-shadow-md ${isStealth ? 'text-white/30 group-hover/overlay:text-white/90' : 'text-white/90'}`}>Gemini</span>
        </div>

        <div className="flex items-center gap-1 text-white/50 no-drag">
          <button onClick={() => setIsStealth(!isStealth)} className={`p-1.5 hover:bg-white/10 rounded-full transition-colors ${isStealth ? 'text-indigo-400' : ''}`} title="Toggle Stealth Mode (Alt+S)">
            {isStealth ? <Ghost size={14} /> : <Eye size={14} />}
          </button>
          <button onClick={togglePiP} className={`p-1.5 hover:bg-white/10 rounded-full transition-colors ${isPiP ? 'text-emerald-400' : ''}`} title="Pop Out"><ExternalLink size={14} /></button>
          <button onClick={() => setChatState(prev => ({ ...prev, messages: [] }))} className="p-1.5 hover:bg-white/10 rounded-full transition-colors" title="Clear Chat"><RefreshCw size={14} /></button>
          {!isPiP && (
             <button onClick={() => setIsMinimized(!isMinimized)} className="p-1.5 hover:bg-white/10 hover:text-white rounded-full transition-colors">
              {isMinimized ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
            </button>
           )}
        </div>
      </div>

      {/* --- Toolbar --- */}
      {!isMinimized && (
        <div className={`px-4 py-2 flex items-center gap-2 bg-white/5 border-b border-white/5 backdrop-blur-sm overflow-x-auto scrollbar-hide transition-opacity duration-300 ${isStealth ? 'opacity-0 group-hover/overlay:opacity-100' : 'opacity-100'}`}>
           <button
            onClick={() => setChatState(prev => ({...prev, config: {...prev.config, useThinking: !prev.config.useThinking}}))}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${chatState.config.useThinking ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'bg-white/5 text-white/40 border border-transparent hover:bg-white/10'}`}
           >
             <BrainCircuit size={12} />
             <span>Deep Think</span>
           </button>
           
           <button
            onClick={() => setChatState(prev => ({...prev, config: {...prev.config, useSearch: !prev.config.useSearch}}))}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${chatState.config.useSearch ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' : 'bg-white/5 text-white/40 border border-transparent hover:bg-white/10'}`}
           >
             <Globe size={12} />
             <span>Search</span>
           </button>

           <button
            onClick={toggleScreenShare}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${isScreenShared ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 animate-pulse' : 'bg-white/5 text-white/40 border border-transparent hover:bg-white/10'}`}
           >
             {isScreenShared ? <Monitor size={12} /> : <Eye size={12} />}
             <span>{isScreenShared ? 'Watching' : 'Watch Screen'}</span>
           </button>
        </div>
      )}

      {/* --- Chat Area --- */}
      <div className={`flex-1 flex flex-col overflow-hidden transition-opacity duration-300 ${isMinimized && !isPiP ? 'opacity-0' : 'opacity-100'}`}>
        <div className={`flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar scroll-smooth ${isStealth ? 'opacity-20 group-hover/overlay:opacity-100 transition-opacity duration-500' : ''}`}>
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
        <div className={`p-4 bg-gradient-to-t from-black/40 to-transparent pt-8 transition-opacity duration-300 ${isStealth ? 'opacity-0 group-hover/overlay:opacity-100' : 'opacity-100'}`}>
           <div className={`relative flex items-center gap-2 bg-gray-900/60 backdrop-blur-xl rounded-[24px] border border-white/10 px-2 py-1 focus-within:border-white/20 focus-within:bg-gray-900/80 transition-all duration-300 shadow-lg ${!isOnline ? 'opacity-50' : ''}`}>
              
              {/* Mic Button */}
              <button 
                onClick={toggleRecording}
                className={`p-3 rounded-full transition-all ${isRecording ? 'bg-red-500 text-white animate-pulse' : 'text-white/50 hover:text-white hover:bg-white/10'}`}
              >
                <Mic size={20} />
              </button>

              <input
                ref={inputRef}
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder={isRecording ? "Listening..." : isScreenShared ? "Ask about this..." : "Type a message..."}
                className="flex-1 bg-transparent text-white placeholder-white/30 px-2 py-3 outline-none font-light"
                disabled={chatState.isLoading || !isOnline}
              />

              <button
                onClick={handleSendMessage}
                disabled={(!inputText.trim() && !isScreenShared) || chatState.isLoading}
                className={`p-3 rounded-[20px] transition-all duration-300 ${
                   (inputText.trim() || isScreenShared) && !chatState.isLoading
                    ? 'bg-white text-black shadow-[0_0_20px_rgba(255,255,255,0.3)] hover:scale-105 active:scale-95'
                    : 'bg-white/5 text-white/20 cursor-not-allowed'
                }`}
              >
                 {chatState.isLoading ? <div className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full animate-spin" /> : <Send size={18} />}
              </button>
           </div>
           <div className="flex justify-between mt-3 px-3">
             <div className="flex items-center gap-2 text-[10px] text-white/30 uppercase tracking-wider font-medium">
                {chatState.config.useThinking ? <BrainCircuit size={10} className="text-indigo-400" /> : null}
                {chatState.config.useThinking ? 'Reasoning Active' : 'Fast Mode'}
             </div>
             <div className={`flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-medium ${isOnline ? 'text-emerald-500/50' : 'text-red-500/50'}`}>
                <div className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-red-500'} animate-pulse`} />
                {isOnline ? 'Online' : 'Offline'}
             </div>
           </div>
        </div>
      </div>
    </div>
  );

  if (isPiP && pipWindowRef.current) return createPortal(content, pipWindowRef.current.document.body);
  return content;
};