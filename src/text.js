export const TAGLINE = 'Clodr - manage all your Claude Code sessions from a single menu';

// "how blockchain works" -> "How-Blockchain-Works"
export function kebabName(text) {
  return text
    .replace(/[^\p{L}\p{N}_\s-]/gu, '')
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('-');
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
