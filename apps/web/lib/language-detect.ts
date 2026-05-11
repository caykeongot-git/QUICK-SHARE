/**
 * QuickShare — Code Detection & Syntax Highlighting
 *
 * Uses heuristic regex patterns to detect if a text snippet is code,
 * and highlights it using highlight.js.
 *
 * @module language-detect
 */

import hljs from 'highlight.js';

// Load commonly used languages directly to save bundle size
// (Since this is an MVP, we load standard web/backend languages)
import 'highlight.js/styles/github-dark.css';

/**
 * Very lightweight heuristic to determine if text is likely source code.
 */
export function isLikelyCode(text: string): boolean {
  if (!text || text.length < 15) return false;

  // Patterns that strongly suggest code
  const codePatterns = [
    /^\s*import\s+.*from\s+['"]/m, // JS/TS/Python import
    /^\s*(export\s+)?(const|let|var|function|class|interface|type)\s+\w+/m, // JS/TS declaration
    /^\s*#include\s+<.*>/m, // C/C++
    /^\s*def\s+\w+\s*\(.*\):/m, // Python func
    /^\s*package\s+[a-z0-9_.]+/m, // Java/Go package
    /^\s*func\s+\w+\s*\(/m, // Go func
    /^\s*<\?php/m, // PHP
    /<[a-z0-9]+(\s+[^>]+)?>.*<\/[a-z0-9]+>/is, // HTML/XML
    /^\s*(SELECT|INSERT|UPDATE|DELETE)\s+.*?\s+FROM/im, // SQL
    /[{};]/, // Braces/semicolons (very common in code)
  ];

  let score = 0;
  for (const pattern of codePatterns) {
    if (pattern.test(text)) score++;
  }

  // Also check if lines have indentation
  const lines = text.split('\n');
  const indentedLines = lines.filter((l) => /^\s+/.test(l)).length;
  if (lines.length > 2 && indentedLines / lines.length > 0.3) {
    score++;
  }

  return score >= 2;
}

/**
 * Auto-detects language and highlights the code snippet.
 */
export function highlightCodeSnippet(text: string): {
  html: string;
  language: string;
} {
  const result = hljs.highlightAuto(text);
  return {
    html: result.value,
    language: result.language || 'plaintext',
  };
}
