'use client';

import * as React from 'react';

interface DropZoneProps {
  onDrop: (file: File) => void;
  children: React.ReactNode;
}

export function DropZone({ onDrop, children }: DropZoneProps) {
  const [isDragging, setIsDragging] = React.useState(false);

  const handleDragOver = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
  }, [isDragging]);

  const handleDragEnter = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file) {
        onDrop(file);
      }
      e.dataTransfer.clearData();
    }
  }, [onDrop]);

  return (
    <div
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="relative w-full h-full min-h-screen"
    >
      {/* Ripple Animation Overlay */}
      <div 
        className={`absolute inset-0 z-50 pointer-events-none transition-all duration-300 ${
          isDragging ? 'bg-primary/10 border-4 border-primary/50 border-dashed rounded-3xl m-4 backdrop-blur-sm' : 'opacity-0'
        }`}
      >
        <div className="flex items-center justify-center h-full w-full">
          {isDragging && (
            <div className="bg-background/80 px-8 py-4 rounded-full shadow-2xl animate-bounce">
              <span className="text-xl font-bold text-primary">Drop file to send securely 🚀</span>
            </div>
          )}
        </div>
      </div>
      
      {children}
    </div>
  );
}
