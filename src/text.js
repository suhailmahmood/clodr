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

// "just now", "5 minutes ago", "2 hours ago", "3 days ago", ...
export function timeAgo(date, now = Date.now()) {
  const s = Math.max(0, Math.floor((now - date.getTime()) / 1000));
  const units = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [name, secs] of units) {
    const n = Math.floor(s / secs);
    if (n >= 1) return `${n} ${name}${n > 1 ? 's' : ''} ago`;
  }
  return 'just now';
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
