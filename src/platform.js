export const WIN = process.platform === 'win32';
export const MAC = process.platform === 'darwin';

// Windows and macOS file systems are case-insensitive by default.
export const CI = WIN || MAC;
