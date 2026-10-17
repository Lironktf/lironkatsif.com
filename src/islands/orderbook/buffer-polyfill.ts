// @solana/spl-token touches the global `Buffer` at module load, which browsers
// don't have. This must be imported BEFORE spl-token (ES imports run in order).
import { Buffer } from 'buffer';

if (typeof (globalThis as any).Buffer === 'undefined') (globalThis as any).Buffer = Buffer;
