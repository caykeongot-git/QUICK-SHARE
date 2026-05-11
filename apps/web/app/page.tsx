'use client';

import * as React from 'react';
import { CommandPalette } from '@/components/CommandPalette';
import { DropZone } from '@/components/DropZone';
import { TransferStatus } from '@/components/TransferStatus';
import { ReceivedDataInbox, createTextItem, createFileItem, type ReceivedItem } from '@/components/ReceivedDataInbox';
import { useWebRTC } from '@/lib/hooks/useWebRTC';
import { toast } from 'sonner';

// Determine the signaling URL based on the environment
const SIGNALING_URL = process.env.NEXT_PUBLIC_SIGNALING_URL || 'ws://127.0.0.1:8787';

export default function Home() {
  const webrtc = useWebRTC({
    signalingUrl: SIGNALING_URL,
    baseUrl: typeof window !== 'undefined' ? window.location.origin : '',
  });

  // Inbox state — persistent received items
  const [receivedItems, setReceivedItems] = React.useState<ReceivedItem[]>([]);

  // Handle URL hash on mount (Receiver joining a room)
  React.useEffect(() => {
    const handleHash = async () => {
      const params = new URLSearchParams(window.location.search);
      const roomId = params.get('room');
      const keyHash = window.location.hash.substring(1);
      
      if (roomId && keyHash) {
        try {
          await webrtc.joinRoom(roomId, keyHash);
          toast.success(`Joining secure room: ${roomId}...`);
          window.history.replaceState(null, '', window.location.pathname);
        } catch (err) {
          toast.error("Failed to join room. Invalid link or key.");
        }
      }
    };
    handleHash();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle received text → add to Inbox (NOT toast)
  React.useEffect(() => {
    if (webrtc.receivedText) {
      const item = createTextItem(webrtc.receivedText);
      setReceivedItems(prev => [item, ...prev]);
      toast.success('New data received!', { duration: 3000 });
    }
  }, [webrtc.receivedText]);

  // Handle received file → add to Inbox (NOT toast)
  React.useEffect(() => {
    if (webrtc.receivedFile) {
      const { blob, metadata } = webrtc.receivedFile;
      const item = createFileItem(blob, metadata);
      setReceivedItems(prev => [item, ...prev]);
      toast.success(`File received: ${metadata.fileName}`, { duration: 3000 });
    }
  }, [webrtc.receivedFile]);

  const handleDismissItem = (id: string) => {
    setReceivedItems(prev => prev.filter(item => item.id !== id));
  };

  const handleClearAll = () => {
    // Revoke object URLs to free memory
    receivedItems.forEach(item => {
      if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
    });
    setReceivedItems([]);
  };

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

        <ReceivedDataInbox
          items={receivedItems}
          onDismiss={handleDismissItem}
          onClearAll={handleClearAll}
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
