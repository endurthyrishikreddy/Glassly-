import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { 
  Send, Sparkles, RefreshCw, Minimize2, Maximize2, ExternalLink, 
  WifiOff, Wifi, Eye, X, Mic, BrainCircuit, Globe, Monitor, GripHorizontal,
  Ghost, EyeOff, Settings, ChevronLeft, Save, Crop, ScanLine, Check, Image as ImageIcon
} from 'lucide-react';
import { Message, ChatState, ModelType } from '../types';
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

const STORAGE_KEY = 'gemini_glass_overlay_history_v3';

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

  // Cropping / Snipping Tool State
  const [isCropping, setIsCropping] = useState(false);
  const [tempScreenshot, setTempScreenshot] = useState<string | null>(null);
  const [cropRect, setCropRect] = useState<Rect | null>(null);
  const [isDrawingCrop, setIsDrawingCrop] = useState(false);
  const [cropStart, setCropStart] = useState<{x: number, y: number} | null>(null);
  const [attachedImage, setAttachedImage] = useState<ScreenshotData | null>(null);

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
          // Migration for old configs
          const config = parsed.config || {};
          return {
            messages: parsed.messages || [],
            isLoading: false,
            error: null,
            config: {
              useSearch: config.useSearch || false,
              useThinking: config.useThinking || false,
              isScreenActive: false,
              model: config.model || ModelType.FLASH,
              temperature: config.temperature !== undefined ? config.temperature : 0.7,
              systemInstruction: config.systemInstruction || "You are a helpful, concise AI assistant living in a transparent glass overlay. Keep answers brief and relevant."
            }
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
      config: { 
        useSearch: false, 
        useThinking: false, 
        isScreenActive: false,
        model: ModelType.FLASH,
        temperature: 0.7,
        systemInstruction: "You are a helpful, concise AI assistant living in a transparent glass overlay. Keep answers brief and relevant."
      }
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
    
    // The service handles logic to upgrade model if thinking is true
    chatSessionRef.current = createChatSession(
      {
        model: chatState.config.model,
        temperature: chatState.config.temperature,
        systemInstruction: chatState.config.systemInstruction,
        useThinking: chatState.config.useThinking,
        useSearch: chatState.config.useSearch
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
    if (!isMinimized && isVisible && !showSettings && !isCropping) scrollToBottom();
  }, [chatState.messages, isOpen, isMinimized, isPiP, isVisible, showSettings, isCropping]);

  // --- Features ---

  // 1. Screen Sharing (Vision)
  const toggleScreenShare = async () => {
    if (isScreenShared) {
      // Stop sharing
      mediaStream?.getTracks().forEach(track => track.stop());
      setMediaStream(null);
      setIsScreenShared(false);
      if (isCropping) cancelCrop();
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
      } catch (err) {
        console.error("Screen share cancelled", err);
        // If user cancelled, we don't error. If permission failed, we might show an alert.
        if (err instanceof DOMException && err.name !== 'NotAllowedError') {
            setChatState(prev => ({...prev, error: "Screen sharing failed. Please check permissions."}));
        }
      }
    }
  };

  const captureFrame = async (): Promise<ScreenshotData | null> => {
    if (!mediaStream) return null;
    
    // Smart Capture: Briefly hide the overlay so we don't block the content
    const wasVisible = isVisible;
    const wasCropping = isCropping; 

    // If we are already in cropping mode, we are displaying a static image, 
    // so we don't need to hide/unhide. But if we are capturing FOR the crop mode:
    if (wasVisible && !isPiP && !wasCropping) {
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
    if (!mediaStream) {
      await toggleScreenShare();
      // If user cancelled the share, mediaStream will still be null (due to state update lag or rejection)
      // We can check if we are shared in a slight timeout or return if isScreenShared is false
      // But since toggleScreenShare is async, we can check after await.
      // Ideally, we can't immediately capture after setting stream state due to React rendering.
      // So we might need a second click or use a ref/effect.
      // For simplicity: prompt user to share first if not shared.
    }
    
    // We need the stream active to capture
    if (!mediaStream && !isScreenShared) {
        // Wait for next cycle or user interaction
        return; 
    }
    
    // Small delay to allow stream to spin up if just started
    await new Promise(r => setTimeout(r, 500));

    // Take the full screenshot
    const screenShot = await captureFrame();
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
  };

  const handleCropMouseDown = (e: React.MouseEvent) => {
    if (!isCropping) return;
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
    
    // We need to map the DOM coordinates (cropRect) to the actual Image dimensions
    // Since the image is "object-contain" in full screen, we need to calculate ratio
    const containerW = overlayRef.current?.clientWidth || 1;
    const containerH = overlayRef.current?.clientHeight || 1;
    
    // The image is displayed using object-contain. 
    // We need to determine the actual rendered dimensions of the image.
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

    // Map mouse coordinates to image coordinates
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
      setChatState(prev => ({ ...prev, isLoading: true }));
      cancelCrop(); // Go back to chat to show loading
      try {
        const text = await extractTextFromImage(croppedBase64);
        setInputText(prev => (prev + "\n" + text).trim());
      } catch (e) {
        console.error(e);
        setChatState(prev => ({ ...prev, error: "OCR Failed" }));
      } finally {
        setChatState(prev => ({ ...prev, isLoading: false }));
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
    if (!inputText.trim() && !mediaStream && !attachedImage) return;
    if (chatState.isLoading || !isOnline) return;

    const currentText = inputText.trim();
    
    // Priority: Attached cropped image -> Full Screen Snapshot -> Text only
    let screenshot: ScreenshotData | null = attachedImage;

    if (!screenshot && isScreenShared) {
      screenshot = await captureFrame();
    }

    // Create User Message
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
    setAttachedImage(null); // Clear attached image after sending

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
        useSearch: chatState.config.useSearch
      },
      history
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
        currentText || (screenshot ? "Analyze this." : ""),
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
  }, [isDragging, isPiP, isCropping]);

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

  // Styles for normal mode vs Cropping mode
  // In Cropping mode, we maximize the container to viewport to allow full screen selection
  const containerStyle: React.CSSProperties = isPiP 
    ? { width: '100%', height: '100vh', borderRadius: 0, border: 'none' }
    : isCropping
      ? { inset: 0, width: '100%', height: '100%', transform: 'none', borderRadius: 0 }
      : position 
        ? { left: `${position.x}px`, top: `${position.y}px`, transform: 'none' }
        : {};

  const stealthClasses = isStealth 
    ? 'bg-black/5 backdrop-blur-[2px] border-white/5 shadow-none opacity-10 hover:opacity-100 hover:bg-black/80 hover:backdrop-blur-2xl hover:shadow-2xl hover:border-white/20' 
    : 'bg-gray-950/30 backdrop-blur-3xl border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.5)]';
  
  const croppingClasses = isCropping ? 'bg-black/80 cursor-crosshair' : stealthClasses;

  const content = (
    <div 
      ref={overlayRef}
      style={containerStyle}
      className={`${isPiP ? 'relative' : 'fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2'} 
        ${isPiP || isCropping ? '' : isMinimized ? 'w-[380px] h-[64px]' : 'w-[90vw] h-[80vh] md:w-[500px] md:h-[700px]'} 
        ${isPiP ? 'bg-black' : croppingClasses} 
        border z-50 flex flex-col ${isCropping ? '' : 'rounded-[32px]'} overflow-hidden transition-all duration-500 ease-out group/overlay`}
      onMouseDown={isCropping ? handleCropMouseDown : undefined}
      onMouseMove={isCropping ? handleCropMouseMove : undefined}
      onMouseUp={isCropping ? handleCropMouseUp : undefined}
    >
      
      {/* --- Cropping UI Layer --- */}
      {isCropping && tempScreenshot && (
        <div className="absolute inset-0 z-50 flex flex-col">
          {/* Background Screenshot */}
          <img 
            src={tempScreenshot} 
            alt="Screen Capture" 
            className="absolute inset-0 w-full h-full object-contain opacity-60 pointer-events-none select-none"
          />
          
          {/* Selection Box */}
          {cropRect && (
             <div 
              className="absolute border-2 border-red-500 bg-white/10 backdrop-contrast-125 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)] pointer-events-none"
              style={{
                left: cropRect.x,
                top: cropRect.y,
                width: cropRect.w,
                height: cropRect.h
              }}
             >
                <div className="absolute -top-6 left-0 bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-t font-bold">
                  {Math.round(cropRect.w)} x {Math.round(cropRect.h)}
                </div>
             </div>
          )}

          {/* Cropping Toolbar */}
          <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex items-center gap-4 bg-gray-900 p-2 rounded-full border border-white/20 shadow-2xl pointer-events-auto">
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
          
          <div className="absolute top-10 left-1/2 -translate-x-1/2 px-6 py-2 bg-black/70 backdrop-blur-md rounded-full text-white font-medium border border-white/10 pointer-events-none">
             Drag to select a region
          </div>
        </div>
      )}

      {/* --- Header (Hidden while cropping) --- */}
      {!isCropping && (
      <div 
        className={`relative flex items-center justify-between px-5 py-4 select-none group/header ${!isPiP && !isMinimized ? 'cursor-grab active:cursor-grabbing' : ''} transition-colors duration-300 ${isDragging ? 'bg-white/10 border-b border-white/10' : 'bg-gradient-to-b from-white/5 to-transparent'}`}
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

        {/* Drag Indicator + Title */}
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
          <button onClick={() => setShowSettings(!showSettings)} className={`p-1.5 hover:bg-white/10 rounded-full transition-colors ${showSettings ? 'text-white bg-white/10' : ''}`} title="Settings">
            <Settings size={14} />
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
      )}

      {/* --- Toolbar (Hidden while cropping) --- */}
      {!isMinimized && !showSettings && !isCropping && (
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

           {/* New Capture Button */}
           <button
             onClick={startRegionCapture}
             className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all bg-white/5 text-white/40 border border-transparent hover:bg-white/10 hover:text-pink-300"
             title="Snipping Tool"
           >
             <Crop size={12} />
             <span>Crop & Ask</span>
           </button>
        </div>
      )}

      {/* --- Settings View --- */}
      {showSettings && !isMinimized && !isCropping && (
        <div className="flex-1 flex flex-col bg-gray-950/80 backdrop-blur-xl p-6 overflow-y-auto animate-fade-in custom-scrollbar">
           <div className="flex items-center gap-3 mb-6 text-white/80">
              <button onClick={() => setShowSettings(false)} className="p-2 rounded-full hover:bg-white/10"><ChevronLeft size={18}/></button>
              <h2 className="text-lg font-semibold">Model Configuration</h2>
           </div>

           <div className="space-y-6">
             {/* Model Select */}
             <div className="space-y-2">
               <label className="text-xs font-medium text-white/50 uppercase tracking-wider">Model Selection</label>
               <div className="grid gap-2">
                  <button 
                    onClick={() => setChatState(prev => ({...prev, config: {...prev.config, model: ModelType.FLASH}}))}
                    className={`flex items-center justify-between p-4 rounded-xl border transition-all ${chatState.config.model === ModelType.FLASH ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400' : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'}`}
                  >
                     <div className="text-left">
                       <div className="font-medium text-sm">Gemini 2.5 Flash</div>
                       <div className="text-xs opacity-60 mt-0.5">Fast, efficient, multimodal</div>
                     </div>
                     {chatState.config.model === ModelType.FLASH && <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.5)]"/>}
                  </button>

                  <button 
                    onClick={() => setChatState(prev => ({...prev, config: {...prev.config, model: ModelType.PRO}}))}
                    className={`flex items-center justify-between p-4 rounded-xl border transition-all ${chatState.config.model === ModelType.PRO ? 'bg-indigo-500/10 border-indigo-500/50 text-indigo-400' : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'}`}
                  >
                     <div className="text-left">
                       <div className="font-medium text-sm">Gemini 3 Pro Preview</div>
                       <div className="text-xs opacity-60 mt-0.5">High reasoning, complex tasks</div>
                     </div>
                     {chatState.config.model === ModelType.PRO && <div className="w-2 h-2 rounded-full bg-indigo-400 shadow-[0_0_10px_rgba(129,140,248,0.5)]"/>}
                  </button>
               </div>
             </div>

             {/* Temperature */}
             <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-medium text-white/50 uppercase tracking-wider">Creativity (Temperature)</label>
                  <span className="text-xs font-mono text-white/80">{chatState.config.temperature.toFixed(1)}</span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max="2" 
                  step="0.1"
                  value={chatState.config.temperature}
                  onChange={(e) => setChatState(prev => ({...prev, config: {...prev.config, temperature: parseFloat(e.target.value)}}))}
                  className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-emerald-500"
                />
                <div className="flex justify-between text-[10px] text-white/30">
                  <span>Precise</span>
                  <span>Balanced</span>
                  <span>Creative</span>
                </div>
             </div>

             {/* System Instructions */}
             <div className="space-y-2">
               <label className="text-xs font-medium text-white/50 uppercase tracking-wider">System Instructions (Persona)</label>
               <textarea 
                 value={chatState.config.systemInstruction}
                 onChange={(e) => setChatState(prev => ({...prev, config: {...prev.config, systemInstruction: e.target.value}}))}
                 className="w-full h-32 bg-black/20 border border-white/10 rounded-xl p-3 text-sm text-white/80 focus:border-emerald-500/50 outline-none resize-none custom-scrollbar"
                 placeholder="Define how the AI should behave..."
               />
             </div>
           </div>
        </div>
      )}

      {/* --- Chat Area (Hidden while cropping) --- */}
      <div className={`flex-1 flex flex-col overflow-hidden transition-opacity duration-300 ${isMinimized && !isPiP ? 'opacity-0' : 'opacity-100'} ${showSettings || isCropping ? 'hidden' : 'flex'}`}>
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
                placeholder={isRecording ? "Listening..." : isScreenShared ? "Ask about this..." : attachedImage ? "Ask about this region..." : "Type a message..."}
                className="flex-1 bg-transparent text-white placeholder-white/30 px-2 py-3 outline-none font-light"
                disabled={chatState.isLoading || !isOnline}
              />

              <button
                onClick={handleSendMessage}
                disabled={(!inputText.trim() && !isScreenShared && !attachedImage) || chatState.isLoading}
                className={`p-3 rounded-[20px] transition-all duration-300 ${
                   (inputText.trim() || isScreenShared || attachedImage) && !chatState.isLoading
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
                {chatState.config.useThinking 
                  ? 'Reasoning Active (Pro)' 
                  : chatState.config.model === ModelType.PRO 
                    ? 'Gemini 3 Pro' 
                    : 'Gemini Flash'}
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