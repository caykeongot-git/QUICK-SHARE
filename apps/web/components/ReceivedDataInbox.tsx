'use client';

import * as React from 'react';
import { type FileMetadata } from '../lib/webrtc';
import { isLikelyCode, highlightCodeSnippet } from '../lib/language-detect';
import { 
  Copy, 
  Check, 
  Download, 
  FileText, 
  Code2, 
  Image as ImageIcon, 
  FileArchive,
  X,
  ChevronDown,
  ChevronUp,
  Inbox
} from 'lucide-react';
import { toast } from 'sonner';

// ─────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────

export interface ReceivedItem {
  id: string;
  type: 'text' | 'code' | 'file';
  timestamp: Date;
  // Text/Code fields
  content?: string;
  language?: string;
  highlightedHtml?: string;
  // File fields
  blob?: Blob;
  metadata?: FileMetadata;
  objectUrl?: string;
}

interface ReceivedDataInboxProps {
  items: ReceivedItem[];
  onDismiss: (id: string) => void;
  onClearAll: () => void;
}

// ─────────────────────────────────────────────────
// Helper: Process incoming data into ReceivedItem
// ─────────────────────────────────────────────────

let itemCounter = 0;

export function createTextItem(text: string): ReceivedItem {
  const isCode = isLikelyCode(text);
  const id = `item-${Date.now()}-${++itemCounter}`;

  if (isCode) {
    const { html, language } = highlightCodeSnippet(text);
    return {
      id,
      type: 'code',
      timestamp: new Date(),
      content: text,
      language,
      highlightedHtml: html,
    };
  }

  return {
    id,
    type: 'text',
    timestamp: new Date(),
    content: text,
  };
}

export function createFileItem(blob: Blob, metadata: FileMetadata): ReceivedItem {
  const id = `item-${Date.now()}-${++itemCounter}`;
  return {
    id,
    type: 'file',
    timestamp: new Date(),
    blob,
    metadata,
    objectUrl: URL.createObjectURL(blob),
  };
}

// ─────────────────────────────────────────────────
// Components
// ─────────────────────────────────────────────────

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success('Copied to clipboard!');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary/15 text-primary hover:bg-primary/25 transition-colors active:scale-95"
    >
      {copied ? (
        <>
          <Check className="w-3.5 h-3.5" />
          <span>Copied!</span>
        </>
      ) : (
        <>
          <Copy className="w-3.5 h-3.5" />
          <span>{label || 'Copy'}</span>
        </>
      )}
    </button>
  );
}

function TextCard({ item, onDismiss }: { item: ReceivedItem; onDismiss: () => void }) {
  const [expanded, setExpanded] = React.useState(true);
  const lines = item.content?.split('\n') || [];
  const isLong = lines.length > 15;

  return (
    <div className="glass-panel rounded-2xl overflow-hidden border border-border/50 shadow-lg animate-in fade-in slide-in-from-bottom-3 duration-300">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-blue-500/15">
            <FileText className="w-4 h-4 text-blue-500" />
          </div>
          <span className="text-sm font-semibold">Received Text</span>
          <span className="text-[10px] text-muted-foreground font-mono">
            {item.timestamp.toLocaleTimeString()}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <CopyButton text={item.content || ''} label="Copy Text" />
          {isLong && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
            >
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          )}
          <button
            onClick={onDismiss}
            className="p-1.5 rounded-lg hover:bg-destructive/20 transition-colors text-muted-foreground hover:text-destructive"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div
        className={`px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words overflow-y-auto transition-all ${
          expanded ? (isLong ? 'max-h-[400px]' : 'max-h-none') : 'max-h-[80px]'
        }`}
      >
        {item.content}
      </div>

      {isLong && !expanded && (
        <div className="px-4 pb-3">
          <button
            onClick={() => setExpanded(true)}
            className="text-xs text-primary hover:text-primary/80 font-medium"
          >
            Show all {lines.length} lines...
          </button>
        </div>
      )}
    </div>
  );
}

function CodeCard({ item, onDismiss }: { item: ReceivedItem; onDismiss: () => void }) {
  const [expanded, setExpanded] = React.useState(true);
  const lines = item.content?.split('\n') || [];
  const isLong = lines.length > 20;

  return (
    <div className="glass-panel rounded-2xl overflow-hidden border border-border/50 shadow-lg animate-in fade-in slide-in-from-bottom-3 duration-300">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-emerald-500/15">
            <Code2 className="w-4 h-4 text-emerald-500" />
          </div>
          <span className="text-sm font-semibold">Code</span>
          <span className="text-[10px] px-2 py-0.5 rounded-md bg-muted text-muted-foreground font-mono uppercase">
            {item.language || 'auto'}
          </span>
          <span className="text-[10px] text-muted-foreground font-mono">
            {lines.length} lines
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <CopyButton text={item.content || ''} label="Copy Code" />
          {isLong && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
            >
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          )}
          <button
            onClick={onDismiss}
            className="p-1.5 rounded-lg hover:bg-destructive/20 transition-colors text-muted-foreground hover:text-destructive"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Code Content */}
      <div
        className={`overflow-x-auto overflow-y-auto transition-all ${
          expanded ? (isLong ? 'max-h-[500px]' : 'max-h-none') : 'max-h-[100px]'
        }`}
      >
        <pre className="p-4 text-xs font-mono leading-relaxed">
          <code
            dangerouslySetInnerHTML={{ __html: item.highlightedHtml || '' }}
          />
        </pre>
      </div>

      {isLong && !expanded && (
        <div className="px-4 pb-3">
          <button
            onClick={() => setExpanded(true)}
            className="text-xs text-primary hover:text-primary/80 font-medium"
          >
            Show all {lines.length} lines...
          </button>
        </div>
      )}
    </div>
  );
}

function FileCard({ item, onDismiss }: { item: ReceivedItem; onDismiss: () => void }) {
  const isImage = item.metadata?.fileType?.startsWith('image/') || false;

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getFileIcon = () => {
    const type = item.metadata?.fileType || '';
    if (type.startsWith('image/')) return <ImageIcon className="w-4 h-4 text-violet-500" />;
    if (type.includes('zip') || type.includes('rar') || type.includes('7z')) return <FileArchive className="w-4 h-4 text-amber-500" />;
    return <FileText className="w-4 h-4 text-sky-500" />;
  };

  const getIconBg = () => {
    const type = item.metadata?.fileType || '';
    if (type.startsWith('image/')) return 'bg-violet-500/15';
    if (type.includes('zip') || type.includes('rar') || type.includes('7z')) return 'bg-amber-500/15';
    return 'bg-sky-500/15';
  };

  return (
    <div className="glass-panel rounded-2xl overflow-hidden border border-border/50 shadow-lg animate-in fade-in slide-in-from-bottom-3 duration-300">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`p-1.5 rounded-lg ${getIconBg()} flex-shrink-0`}>
            {getFileIcon()}
          </div>
          <span className="text-sm font-semibold truncate">{item.metadata?.fileName || 'Unknown File'}</span>
          <span className="text-[10px] text-muted-foreground font-mono flex-shrink-0">
            {formatBytes(item.metadata?.fileSize || 0)}
          </span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
          <button
            onClick={onDismiss}
            className="p-1.5 rounded-lg hover:bg-destructive/20 transition-colors text-muted-foreground hover:text-destructive"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Image Preview */}
      {isImage && item.objectUrl && (
        <div className="px-4 pt-3">
          <div className="rounded-xl overflow-hidden border border-border/30 bg-black/5">
            <img
              src={item.objectUrl}
              alt={item.metadata?.fileName || 'Image preview'}
              className="w-full max-h-[300px] object-contain"
            />
          </div>
        </div>
      )}

      {/* Download Button */}
      <div className="p-4 flex items-center gap-3">
        <a
          href={item.objectUrl || '#'}
          download={item.metadata?.fileName}
          className="flex-1 flex items-center justify-center gap-2 bg-primary text-primary-foreground font-medium py-3 rounded-xl hover:bg-primary/90 transition-colors shadow-sm active:scale-[0.98]"
        >
          <Download className="w-4 h-4" />
          <span>Download File</span>
        </a>
        <div className="text-[10px] text-muted-foreground text-center flex-shrink-0 max-w-[80px]">
          {item.metadata?.fileType || 'Unknown'}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────
// Main Inbox Component
// ─────────────────────────────────────────────────

export function ReceivedDataInbox({ items, onDismiss, onClearAll }: ReceivedDataInboxProps) {
  if (items.length === 0) return null;

  return (
    <div className="w-full max-w-2xl mx-auto mt-6 flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Inbox Header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <Inbox className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">
            Received ({items.length})
          </span>
        </div>
        {items.length > 1 && (
          <button
            onClick={onClearAll}
            className="text-xs text-muted-foreground hover:text-destructive transition-colors font-medium"
          >
            Clear All
          </button>
        )}
      </div>

      {/* Items */}
      <div className="flex flex-col gap-3">
        {items.map((item) => {
          switch (item.type) {
            case 'text':
              return <TextCard key={item.id} item={item} onDismiss={() => onDismiss(item.id)} />;
            case 'code':
              return <CodeCard key={item.id} item={item} onDismiss={() => onDismiss(item.id)} />;
            case 'file':
              return <FileCard key={item.id} item={item} onDismiss={() => onDismiss(item.id)} />;
            default:
              return null;
          }
        })}
      </div>
    </div>
  );
}
