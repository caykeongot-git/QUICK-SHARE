'use client';

import * as React from 'react';
import { CommandPalette } from '@/components/CommandPalette';
import { DropZone } from '@/components/DropZone';
import { TransferStatus } from '@/components/TransferStatus';
import { useWebRTC } from '@/lib/hooks/useWebRTC';
import { isLikelyCode, highlightCodeSnippet } from '@/lib/language-detect';
import { toast } from 'sonner';

// Determine the signaling URL based on the environment
// Using the local Wrangler dev server for now. In prod, this would be env injected.
const SIGNALING_URL = process.env.NEXT_PUBLIC_SIGNALING_URL || 'ws://127.0.0.1:8787';

export default function Home() {
  const webrtc = useWebRTC({
    signalingUrl: SIGNALING_URL,
    baseUrl: typeof window !== 'undefined' ? window.location.origin : '',
  });

  // Handle URL hash on mount (Receiver joining a room)
  React.useEffect(() => {
    const handleHash = async () => {
      const hash = window.location.hash.substring(1); // remove '#'
      
      // Expected URL format: #room=roomId&key=keyHash
      const params = new URLSearchParams(hash);
      const roomId = params.get('room');
      const keyHash = params.get('key');
      
      if (roomId && keyHash) {
        try {
          await webrtc.joinRoom(roomId, keyHash);
          toast.success(`Joining secure room: ${roomId}...`);
          // Clear hash to avoid re-joining on refresh
          window.history.replaceState(null, '', window.location.pathname);
        } catch (err) {
          toast.error("Failed to join room. Invalid link or key.");
        }
      }
    };
    handleHash();
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle received text and files
  React.useEffect(() => {
    if (webrtc.receivedText) {
      const isCode = isLikelyCode(webrtc.receivedText);
      
      if (isCode) {
        const { html, language } = highlightCodeSnippet(webrtc.receivedText);
        toast(`Received Code (${language})`, {
          description: (
            <div 
              className="mt-2 p-2 bg-background/50 rounded-md overflow-x-auto max-h-[300px] text-xs font-mono"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          ),
          action: {
            label: "Copy",
            onClick: () => navigator.clipboard.writeText(webrtc.receivedText || "")
          },
          duration: 10000, // Show longer for code
        });
      } else {
        toast("Received Text", {
          description: webrtc.receivedText,
          action: {
            label: "Copy",
            onClick: () => navigator.clipboard.writeText(webrtc.receivedText || "")
          }
        });
      }
    }

    if (webrtc.receivedFile) {
      const { blob, metadata } = webrtc.receivedFile;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = metadata.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast.success(`Received file: ${metadata.fileName}`);
    }
  }, [webrtc.receivedText, webrtc.receivedFile]);

  // Handle file drop
  const handleFileDrop = async (file: File) => {
    if (webrtc.status !== 'connected') {
      toast.error('Not connected to a peer yet. Create a room first.');
      return;
    }
    
    try {
      await webrtc.sendFile(file);
    } catch (err) {
      console.error(err);
      toast.error('Failed to send file');
    }
  };

  return (
    <DropZone onDrop={handleFileDrop}>
      <main className="flex min-h-screen flex-col items-center justify-center p-4 sm:p-8 pt-24 pb-32">
        <div className="w-full max-w-2xl mb-8 text-center animate-in fade-in slide-in-from-top-8 duration-700">
          <h1 className="text-4xl sm:text-5xl font-black mb-4 tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-primary to-secondary">
            QuickShare
          </h1>
          <p className="text-muted-foreground text-lg sm:text-xl font-medium max-w-lg mx-auto leading-relaxed">
            Zero-egress, E2E encrypted P2P file & text sharing.
          </p>
        </div>

        <CommandPalette webrtc={webrtc} onFileDrop={handleFileDrop} />
        
        <TransferStatus 
          progress={webrtc.progress} 
          status={webrtc.status} 
          shareUrl={webrtc.shareUrl} 
        />
        
        <div className="absolute bottom-8 left-0 w-full text-center opacity-50 pointer-events-none">
          <p className="text-xs text-muted-foreground font-mono">
            E2EE Active • TCP/443 Relay • Zero Trust
          </p>
        </div>
      </main>
    </DropZone>
  );
}
