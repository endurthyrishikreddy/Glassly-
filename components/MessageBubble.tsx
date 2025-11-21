import React, { useState } from 'react';
import { Message } from '../types';
import { User, Bot, Volume2, Loader2 } from 'lucide-react';
import { generateSpeech } from '../services/geminiService';

interface MessageBubbleProps {
  message: Message;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const isUser = message.role === 'user';
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);

  const playAudio = async () => {
    if (isPlaying) return;
    setIsLoadingAudio(true);
    try {
      const audioBuffer = await generateSpeech(message.text);
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const buffer = await audioContext.decodeAudioData(audioBuffer);
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      source.start(0);
      setIsPlaying(true);
      source.onended = () => setIsPlaying(false);
    } catch (error) {
      console.error("Failed to play audio", error);
    } finally {
      setIsLoadingAudio(false);
    }
  };

  return (
    <div className={`flex w-full mb-4 md:mb-6 ${isUser ? 'justify-end' : 'justify-start'} animate-fade-in-up group px-1`}>
      <div className={`flex max-w-[95%] md:max-w-[85%] ${isUser ? 'flex-row-reverse' : 'flex-row'} items-start gap-2 md:gap-3 min-w-0`}>
        
        {/* Avatar */}
        <div className={`flex-shrink-0 w-6 h-6 md:w-8 md:h-8 rounded-full flex items-center justify-center mt-1 shadow-lg ${
          isUser 
            ? 'bg-gradient-to-br from-indigo-500 to-purple-600' 
            : 'bg-gradient-to-br from-emerald-500 to-teal-600'
        }`}>
          {isUser ? <User size={12} className="text-white md:w-[14px] md:h-[14px]" /> : <Bot size={12} className="text-white md:w-[14px] md:h-[14px]" />}
        </div>

        {/* Content Column */}
        <div className={`flex flex-col min-w-0 ${isUser ? 'items-end' : 'items-start'}`}>
          <div className={`
            relative px-4 py-3 md:px-5 md:py-3.5 rounded-2xl text-sm md:text-[15px] leading-relaxed shadow-xl backdrop-blur-xl
            transition-all duration-300 break-words whitespace-pre-wrap max-w-full
            ${isUser 
              ? 'bg-indigo-600/90 text-white rounded-tr-none border border-indigo-400/30' 
              : 'bg-gray-800/70 text-gray-100 rounded-tl-none border border-white/10'
            }
          `}>
            {/* Shine effect */}
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/10 to-transparent pointer-events-none" />
            
            <div className="font-normal tracking-wide break-words">
              {message.text}
              {message.isStreaming && (
                <span className="inline-flex ml-1 gap-0.5 align-baseline">
                  <span className="w-1 h-1 bg-current rounded-full animate-bounce" style={{ animationDelay: '0ms' }}/>
                  <span className="w-1 h-1 bg-current rounded-full animate-bounce" style={{ animationDelay: '150ms' }}/>
                  <span className="w-1 h-1 bg-current rounded-full animate-bounce" style={{ animationDelay: '300ms' }}/>
                </span>
              )}
            </div>
          </div>

          {/* Footer Actions */}
          <div className={`flex items-center gap-2 mt-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
            <span className="text-[10px] text-white/30 font-medium whitespace-nowrap">
              {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            
            {!isUser && !message.isStreaming && (
              <button 
                onClick={playAudio}
                disabled={isLoadingAudio}
                className="p-1 text-white/40 hover:text-emerald-400 transition-colors rounded-full hover:bg-white/5"
                title="Read Aloud"
              >
                {isLoadingAudio ? <Loader2 size={12} className="animate-spin" /> : <Volume2 size={12} />}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};