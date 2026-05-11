/**
 * QuickShare — useWebRTC React Hook
 *
 * Wraps WebRTCManager + CryptoModule into reactive React state.
 * Provides a clean API for components to:
 * - Create/join rooms
 * - Send/receive files and text
 * - Track connection status and transfer progress
 *
 * @module useWebRTC
 */

'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  WebRTCManager,
  type ConnectionStatus,
  type TransferProgress,
  type FileMetadata,
  type IceServerConfig,
} from '../webrtc';
import {
  generateKey,
  exportKeyToBase64URL,
  importKeyFromBase64URL,
  buildShareURL,
  extractKeyFromHash,
} from '../crypto';

// ─────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────

export interface UseWebRTCOptions {
  /** Signaling server URL (e.g. wss://quickshare-signaling.workers.dev) */
  signalingUrl: string;
  /** TURN server configurations (from env vars) */
  turnServers?: IceServerConfig[];
  /** Base URL for building share links */
  baseUrl?: string;
}

export interface UseWebRTCReturn {
  /** Current connection status */
  status: ConnectionStatus;
  /** Transfer progress (null when not transferring) */
  progress: TransferProgress | null;
  /** Room ID (null when not in a room) */
  roomId: string | null;
  /** Shareable URL with encryption key in fragment */
  shareUrl: string | null;
  /** Received text content */
  receivedText: string | null;
  /** Received file info */
  receivedFile: { blob: Blob; metadata: FileMetadata } | null;
  /** Error message */
  error: string | null;

  // Actions
  /** Create a new room (as sender) */
  createRoom: () => Promise<void>;
  /** Join an existing room (as receiver) with key from URL hash */
  joinRoom: (roomId: string, keyHash: string) => Promise<void>;
  /** Send a file */
  sendFile: (file: File) => Promise<void>;
  /** Send text */
  sendText: (text: string) => Promise<void>;
  /** Disconnect and clean up */
  disconnect: () => void;
  /** Reset state for a new transfer */
  reset: () => void;
}

// ─────────────────────────────────────────────────
// Hook Implementation
// ─────────────────────────────────────────────────

export function useWebRTC(options: UseWebRTCOptions): UseWebRTCReturn {
  const { signalingUrl, turnServers = [], baseUrl = '' } = options;

  // Reactive state
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [progress, setProgress] = useState<TransferProgress | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [receivedText, setReceivedText] = useState<string | null>(null);
  const [receivedFile, setReceivedFile] = useState<{
    blob: Blob;
    metadata: FileMetadata;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refs (non-reactive)
  const managerRef = useRef<WebRTCManager | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      managerRef.current?.disconnect();
    };
  }, []);

  /**
   * Create a new WebRTCManager instance with event handlers.
   */
  const createManager = useCallback((): WebRTCManager => {
    // Disconnect existing manager
    managerRef.current?.disconnect();

    const manager = new WebRTCManager(turnServers, {
      onStatusChange: (s) => setStatus(s),
      onProgress: (p) => setProgress(p),
      onTextReceived: (text) => setReceivedText(text),
      onFileReceived: (blob, meta) => setReceivedFile({ blob, metadata: meta }),
      onError: (err) => setError(err.message),
      onPeerJoined: () => {
        // Status is managed by the manager
      },
      onPeerLeft: () => {
        setError('Peer disconnected.');
      },
    });

    managerRef.current = manager;
    return manager;
  }, [turnServers]);

  /**
   * Create a new room as the SENDER.
   *
   * 1. Generate encryption key
   * 2. Request room ID from signaling server
   * 3. Build shareable URL (key in fragment)
   * 4. Connect as sender and wait for peer
   */
  const createRoom = useCallback(async () => {
    try {
      setError(null);
      setProgress(null);
      setReceivedText(null);
      setReceivedFile(null);

      // Generate E2EE key
      const key = await generateKey();

      // Request a new room from the signaling server
      const httpBase = signalingUrl.replace(/^ws/, 'http');
      const res = await fetch(`${httpBase}/api/room/new`);
      if (!res.ok) {
        throw new Error('Failed to create room.');
      }
      const data = (await res.json()) as { roomId: string };
      setRoomId(data.roomId);

      // Build shareable URL with key in fragment
      const effectiveBase = baseUrl || window.location.origin;
      const url = await buildShareURL(effectiveBase, data.roomId, key);
      setShareUrl(url);

      // Create manager and connect
      const manager = createManager();
      manager.setEncryptionKey(key);
      await manager.connectAsSender(signalingUrl, data.roomId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create room.');
      setStatus('error');
    }
  }, [signalingUrl, baseUrl, createManager]);

  /**
   * Join an existing room as the RECEIVER.
   *
   * 1. Extract encryption key from URL hash
   * 2. Connect to the room via signaling
   * 3. Wait for sender's offer
   */
  const joinRoom = useCallback(
    async (targetRoomId: string, keyHash: string) => {
      try {
        setError(null);
        setProgress(null);
        setReceivedText(null);
        setReceivedFile(null);
        setRoomId(targetRoomId);

        // Import key from hash
        const key = await extractKeyFromHash(keyHash);

        // Create manager and connect
        const manager = createManager();
        manager.setEncryptionKey(key);
        await manager.connectAsReceiver(signalingUrl, targetRoomId);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to join room.'
        );
        setStatus('error');
      }
    },
    [signalingUrl, createManager]
  );

  /**
   * Send a file to the connected peer.
   */
  const sendFile = useCallback(async (file: File) => {
    try {
      setError(null);
      setProgress(null);
      if (!managerRef.current) {
        throw new Error('Not connected to a room.');
      }
      await managerRef.current.sendFile(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send file.');
      setStatus('error');
    }
  }, []);

  /**
   * Send text to the connected peer.
   */
  const sendText = useCallback(async (text: string) => {
    try {
      setError(null);
      if (!managerRef.current) {
        throw new Error('Not connected to a room.');
      }
      await managerRef.current.sendText(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send text.');
      setStatus('error');
    }
  }, []);

  /**
   * Disconnect and clean up.
   */
  const disconnect = useCallback(() => {
    managerRef.current?.disconnect();
    managerRef.current = null;
    setStatus('idle');
    setRoomId(null);
    setShareUrl(null);
  }, []);

  /**
   * Reset all state for a new transfer.
   */
  const reset = useCallback(() => {
    disconnect();
    setProgress(null);
    setReceivedText(null);
    setReceivedFile(null);
    setError(null);
  }, [disconnect]);

  return {
    status,
    progress,
    roomId,
    shareUrl,
    receivedText,
    receivedFile,
    error,
    createRoom,
    joinRoom,
    sendFile,
    sendText,
    disconnect,
    reset,
  };
}
