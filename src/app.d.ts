// Ambient types for Svelte
/// <reference types="svelte" />
/// <reference types="vite/client" />

// Build-time injected constants (see vite.config.ts define)
declare const __APP_VERSION__: string; // e.g. "0.2.0"
declare const __GIT_HASH__: string;    // git short hash or 'unknown'
declare const __BUILD_ID__: string;    // `${version}+${hash}` composite
