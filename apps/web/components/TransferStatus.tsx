'use client';

import * as React from 'react';
import { type TransferProgress } from '../lib/webrtc';
import { FileUp, CheckCircle2, Copy, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { QRCodeSVG } from 'qrcode.react';

interface TransferStatusProps {
  progress: TransferProgress | null;
  status: string;
  shareUrl: string | null;
}

export function TransferStatus({ progress, status, shareUrl }: TransferStatusProps) {
  
  const handleCopyLink = () => {
    if (shareUrl) {
      navigator.clipboard.writeText(shareUrl);
      toast.success("Secure link copied to clipboard!");
    }
  };

  if (status === 'waiting' && shareUrl) {
    let roomId = '';
    let keyString = '';
    try {
      const url = new URL(shareUrl);
      roomId = url.searchParams.get('room') || '';
      keyString = url.hash.substring(1);
    } catch {}

    return (
      <div className="w-full max-w-2xl mx-auto mt-6 glass-panel rounded-3xl p-6 md:p-8 animate-in fade-in slide-in-from-bottom-4 shadow-xl border border-border/50">
        <div className="flex flex-col md:flex-row gap-8 items-center md:items-start">
          
          {/* QR Code Section */}
          <div className="flex flex-col items-center gap-3 bg-white p-4 rounded-2xl shadow-sm">
            <QRCodeSVG 
              value={shareUrl} 
              size={160} 
              bgColor="#ffffff" 
              fgColor="#000000" 
              level="M" 
              includeMargin={false}
            />
            <div className="flex items-center gap-2 text-xs font-medium text-black/60">
              <Smartphone className="w-4 h-4" />
              <span>Scan to join</span>
            </div>
          </div>

          {/* Details Section */}
          <div className="flex-1 flex flex-col w-full text-center md:text-left">
            <h3 className="text-xl font-bold mb-2 text-foreground">Room Created</h3>
            <p className="text-sm text-muted-foreground mb-6">
              Scan the QR code with your phone camera, or share the secure link below.
            </p>
            
            <div className="flex flex-col gap-4">
              {/* Share Link */}
              <div className="flex items-center gap-2 bg-background/50 border border-border/60 p-2.5 rounded-xl text-sm font-mono focus-within:ring-2 ring-primary/50 transition-all w-full overflow-hidden">
                <span className="flex-1 min-w-0 truncate opacity-80 px-2">{shareUrl}</span>
                <button 
                  onClick={handleCopyLink}
                  className="p-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg transition-colors flex-shrink-0 shadow-sm"
                  title="Copy Link"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>

              {/* Manual Join Code */}
              <div className="flex flex-col gap-3 mt-2">
                <div className="bg-background/40 border border-border/40 p-3 rounded-xl flex items-center justify-between gap-2 group">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">Room ID</span>
                    <span className="font-mono text-sm font-medium">{roomId}</span>
                  </div>
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(roomId);
                      toast.success("Room ID copied!");
                    }}
                    className="p-2 hover:bg-muted rounded-lg transition-all text-muted-foreground hover:text-foreground flex-shrink-0"
                    title="Copy Room ID"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
                <div className="bg-background/40 border border-border/40 p-3 rounded-xl flex flex-col gap-1.5 group">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">Secret Key</span>
                    <button 
                      onClick={() => {
                        navigator.clipboard.writeText(keyString);
                        toast.success("Secret Key copied!");
                      }}
                      className="p-2 hover:bg-muted rounded-lg transition-all text-muted-foreground hover:text-foreground flex-shrink-0"
                      title="Copy Secret Key"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                  <span className="font-mono text-xs font-medium break-all leading-relaxed select-all">{keyString}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!progress) return null;

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const isDone = progress.ratio >= 1.0 || status === 'done';
  const percentage = Math.round(progress.ratio * 100);

  return (
    <div className="w-full max-w-2xl mx-auto mt-6 glass-panel rounded-2xl p-6 shadow-xl animate-in fade-in slide-in-from-bottom-4">
      <div className="flex items-center gap-4 mb-4">
        <div className={`p-3 rounded-xl ${isDone ? 'bg-secondary/20 text-secondary-foreground' : 'bg-primary/20 text-primary'} transition-colors`}>
          {isDone ? <CheckCircle2 className="w-6 h-6" /> : <FileUp className="w-6 h-6 animate-pulse" />}
        </div>
        <div className="flex-1 overflow-hidden">
          <h4 className="font-semibold truncate">{progress.fileName || 'Data Transfer'}</h4>
          <p className="text-sm text-muted-foreground">
            {formatBytes(progress.transferredBytes)} / {formatBytes(progress.totalBytes)} 
            {!isDone && progress.speed > 0 && ` • ${formatBytes(progress.speed)}/s`}
          </p>
        </div>
        <div className="text-2xl font-bold font-mono w-16 text-right">
          {percentage}%
        </div>
      </div>

      <div className="w-full bg-background/50 rounded-full h-2.5 mb-2 overflow-hidden border border-border/50">
        <div 
          className="bg-primary h-2.5 rounded-full transition-all duration-300 ease-out" 
          style={{ width: `${percentage}%` }}
        ></div>
      </div>
      
      {isDone && (
        <p className="text-center text-sm font-medium text-secondary-foreground mt-4">
          Transfer completed successfully via encrypted P2P channel.
        </p>
      )}
    </div>
  );
}
