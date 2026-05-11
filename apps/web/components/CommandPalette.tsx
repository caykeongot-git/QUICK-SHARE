'use client';

import * as React from 'react';
import { Command } from 'cmdk';
import { 
  Send, 
  ClipboardPaste, 
  ScanText, 
  Code2, 
  SunMoon, 
  Activity, 
  Trash2,
  File,
  X
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { useWebRTC } from '../lib/hooks/useWebRTC';
import { extractTextFromImage } from '../lib/ai';
import { toast } from 'sonner';

interface CommandPaletteProps {
  webrtc: ReturnType<typeof useWebRTC>;
  onFileDrop: (file: File) => void;
}

export function CommandPalette({ webrtc, onFileDrop }: CommandPaletteProps) {
  const [open, setOpen] = React.useState(true);
  const { setTheme, theme } = useTheme();

  // Handle global keyboard shortcuts
  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
      if (e.key === 'Escape') {
        // If searching, let cmdk handle escape. Otherwise close/blur.
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  const handleToggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
    setOpen(false);
  };

  const handlePasteClipboard = async () => {
    try {
      // First try to read as text
      const text = await navigator.clipboard.readText().catch(() => null);
      if (text) {
        await webrtc.sendText(text);
        return;
      }
    } catch (err) {
      console.error('Failed to read clipboard', err);
    }
  };

  const handleExtractTextFromClipboard = async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageTypes = item.types.filter(type => type.startsWith('image/'));
        if (imageTypes.length > 0) {
          const blob = await item.getType(imageTypes[0]);
          
          let toastId: string | number = '';
          const result = await extractTextFromImage(blob, (progress) => {
            if (!toastId) {
              toastId = toast.loading(`Scanning image for text... ${Math.round(progress * 100)}%`);
            } else {
              toast.loading(`Scanning image for text... ${Math.round(progress * 100)}%`, { id: toastId });
            }
          });
          
          toast.dismiss(toastId);
          if (result.text) {
            await webrtc.sendText(result.text);
            toast.success(`Extracted & sent text! (Confidence: ${Math.round(result.confidence)}%)`);
          } else {
            toast.error("No text could be extracted from the image.");
          }
          return;
        }
      }
      toast.error("No image found in clipboard. Please copy an image first.");
    } catch (err) {
      console.error(err);
      toast.error("Failed to read clipboard image. Please check permissions.");
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto glass-panel rounded-3xl overflow-hidden shadow-2xl relative">
      <Command 
        className="w-full bg-transparent flex flex-col"
        shouldFilter={true}
      >
        <div className="flex items-center border-b border-border/50 px-4">
          <Command.Input 
            autoFocus
            className="flex-1 bg-transparent py-5 text-lg outline-none placeholder:text-muted-foreground text-foreground" 
            placeholder="Type a command or search..." 
          />
          <kbd className="hidden sm:inline-flex items-center gap-1 rounded border border-border bg-muted px-2 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
            <span className="text-xs">⌘</span>K
          </kbd>
        </div>

        {/* Dynamic Status Area */}
        {webrtc.status !== 'idle' && (
          <div className="px-4 py-3 bg-primary/10 border-b border-border/50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary animate-pulse" />
              <span className="text-sm font-medium">
                {webrtc.status === 'connecting' && 'Connecting to signaling server...'}
                {webrtc.status === 'waiting' && 'Waiting for peer to join...'}
                {webrtc.status === 'signaling' && 'Negotiating secure connection...'}
                {webrtc.status === 'connected' && 'Secure connection established.'}
                {webrtc.status === 'transferring' && 'Transferring data...'}
                {webrtc.status === 'done' && 'Transfer complete.'}
                {webrtc.status === 'error' && <span className="text-destructive">{webrtc.error || 'Connection error'}</span>}
              </span>
            </div>
            {webrtc.roomId && (
               <div className="text-xs text-muted-foreground bg-background/50 px-2 py-1 rounded-md border border-border/50">
                 Room: {webrtc.roomId}
               </div>
            )}
          </div>
        )}

        <Command.List className="max-h-[300px] overflow-y-auto p-2 scrollbar-thin">
          <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
            No results found.
          </Command.Empty>

          <Command.Group heading="Share & Connect" className="text-xs font-medium text-muted-foreground px-2 py-1">
            
            {webrtc.status === 'idle' && (
              <Command.Item 
                className="flex items-center gap-3 px-3 py-3 rounded-xl cursor-pointer aria-selected:bg-primary/20 aria-selected:text-foreground text-foreground/80 transition-colors"
                onSelect={() => webrtc.createRoom()}
              >
                <Activity className="w-5 h-5" />
                <div className="flex flex-col">
                  <span className="font-medium">Create Secure Room</span>
                  <span className="text-xs opacity-70">Start a new zero-trust P2P session</span>
                </div>
              </Command.Item>
            )}

            {webrtc.status === 'connected' && (
              <>
                <Command.Item 
                  className="flex items-center gap-3 px-3 py-3 rounded-xl cursor-pointer aria-selected:bg-primary/20 aria-selected:text-foreground text-foreground/80 transition-colors"
                  onSelect={() => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.onchange = (e) => {
                      const file = (e.target as HTMLInputElement).files?.[0];
                      if (file) onFileDrop(file);
                    };
                    input.click();
                  }}
                >
                  <Send className="w-5 h-5" />
                  <div className="flex flex-col">
                    <span className="font-medium">Send File</span>
                    <span className="text-xs opacity-70">Browse and send a file to the peer</span>
                  </div>
                </Command.Item>

                <Command.Item 
                  className="flex items-center gap-3 px-3 py-3 rounded-xl cursor-pointer aria-selected:bg-primary/20 aria-selected:text-foreground text-foreground/80 transition-colors"
                  onSelect={handlePasteClipboard}
                >
                  <ClipboardPaste className="w-5 h-5" />
                  <div className="flex flex-col">
                    <span className="font-medium">Paste from Clipboard</span>
                    <span className="text-xs opacity-70">Send copied text securely</span>
                  </div>
                </Command.Item>
              </>
            )}
          </Command.Group>

          <Command.Group heading="AI Tools (Local)" className="text-xs font-medium text-muted-foreground px-2 py-1 mt-2">
             {webrtc.status === 'connected' && (
               <Command.Item 
                  className="flex items-center gap-3 px-3 py-3 rounded-xl cursor-pointer aria-selected:bg-primary/20 aria-selected:text-foreground text-foreground/80 transition-colors"
                  onSelect={handleExtractTextFromClipboard}
                >
                  <ScanText className="w-5 h-5" />
                  <div className="flex flex-col">
                    <span className="font-medium">Extract & Send Text from Copied Image</span>
                    <span className="text-xs opacity-70">OCR local execution (Tesseract)</span>
                  </div>
                </Command.Item>
             )}

              <Command.Item 
                className="flex items-center gap-3 px-3 py-3 rounded-xl cursor-pointer aria-selected:bg-primary/20 aria-selected:text-foreground text-foreground/80 transition-colors opacity-50"
                disabled
              >
                <Code2 className="w-5 h-5" />
                <div className="flex flex-col">
                  <span className="font-medium">Auto Syntax Highlight</span>
                  <span className="text-xs opacity-70">Code is automatically detected when received</span>
                </div>
              </Command.Item>
          </Command.Group>

          <Command.Group heading="System" className="text-xs font-medium text-muted-foreground px-2 py-1 mt-2">
            <Command.Item 
              className="flex items-center gap-3 px-3 py-3 rounded-xl cursor-pointer aria-selected:bg-primary/20 aria-selected:text-foreground text-foreground/80 transition-colors"
              onSelect={handleToggleTheme}
            >
              <SunMoon className="w-5 h-5" />
              <div className="flex flex-col">
                <span className="font-medium">Toggle Theme</span>
                <span className="text-xs opacity-70">Switch between Lofi Night and Playful Pastel</span>
              </div>
            </Command.Item>

            {webrtc.status !== 'idle' && (
              <Command.Item 
                className="flex items-center gap-3 px-3 py-3 rounded-xl cursor-pointer aria-selected:bg-destructive/20 text-destructive transition-colors"
                onSelect={() => webrtc.disconnect()}
              >
                <Trash2 className="w-5 h-5" />
                <div className="flex flex-col">
                  <span className="font-medium">Destroy Room</span>
                  <span className="text-xs opacity-70">Disconnect and clear all secure state</span>
                </div>
              </Command.Item>
            )}
          </Command.Group>

        </Command.List>
      </Command>
    </div>
  );
}
