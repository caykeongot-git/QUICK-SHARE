/**
 * QuickShare — Local AI OCR (Optical Character Recognition)
 *
 * Uses Tesseract.js to extract text from images directly in the browser via Web Workers.
 * No data is sent to external servers.
 *
 * @module ai
 */

import { createWorker } from 'tesseract.js';

export interface OCRResult {
  text: string;
  confidence: number;
}

/**
 * Extracts text from an image Blob using Tesseract.js.
 * Automatically spawns a Web Worker to avoid blocking the main thread.
 *
 * @param imageBlob The image file/blob to process
 * @param onProgress Optional callback for loading progress
 */
export async function extractTextFromImage(
  imageBlob: Blob,
  onProgress?: (progress: number) => void
): Promise<OCRResult> {
  const worker = await createWorker('eng+vie', 1, {
    logger: (m: any) => {
      // Tesseract logs status updates like 'recognizing text' with progress 0-1
      if (m.status === 'recognizing text' && onProgress) {
        onProgress(m.progress);
      }
    },
  });

  try {
    // Convert Blob to URL for Tesseract
    const imageUrl = URL.createObjectURL(imageBlob);
    const { data } = await worker.recognize(imageUrl);
    URL.revokeObjectURL(imageUrl);

    return {
      text: data.text.trim(),
      confidence: data.confidence, // 0 to 100
    };
  } finally {
    await worker.terminate();
  }
}
