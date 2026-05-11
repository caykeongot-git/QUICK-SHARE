'use client';

import * as React from 'react';
import { type TransferProgress } from '../lib/webrtc';
import { FileUp, CheckCircle2, Copy } from 'lucide-react';
import { toast } from 'sonner';

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
    return (
      <div className="w-full max-w-2xl mx-auto mt-6 glass-panel rounded-2xl p-6 text-center animate-in fade-in slide-in-from-bottom-4">
        <h3 className="text-lg font-semibold mb-2">Room Created</h3>
        <p className="text-muted-foreground mb-4">Share this link with the receiver. The encryption key is embedded securely in the URL.</p>
        
        <div className="flex items-center gap-2 bg-background/50 border border-border p-3 rounded-xl break-all text-sm font-mono">
          <span className="flex-1 text-left opacity-80">{shareUrl}</span>
          <button 
            onClick={handleCopyLink}
            className="p-2 hover:bg-primary/20 text-primary rounded-lg transition-colors flex-shrink-0"
            title="Copy Link"
          >
            <Copy className="w-5 h-5" />
          </button>
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
