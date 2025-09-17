// Secret / credential detection utility
// Heuristic scanning only; does not transmit data.

export interface SecretDetectionResult {
  reasons: string[];
}

const SUSPICIOUS_KEY_PATTERNS = [
  /password/i,
  /passwd/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /access[_-]?key/i,
  /private[_-]?key/i,
  /ssh[_-]?key/i,
  /cert(ificate)?/i,
  /auth/i
];

const PRIVATE_KEY_BLOCK = /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/;
// Generic secret-like patterns:
//  - AWS access key (AKIA...)
//  - Long opaque base62-ish strings (>= 40 chars)
//  - JWT-like tokens (three base64url segments) with a minimum segment length to avoid matching ordinary dotted identifiers
const GENERIC_SECRET_LIKE = /(AKIA[0-9A-Z]{16})|([A-Za-z0-9_-]{40,})|([A-Za-z0-9-_]{10,}\.[A-Za-z0-9-_]{10,}\.[A-Za-z0-9-_]{10,})/; // AWS style, JWT, or long opaque strings

// Environment variable style FOO=bar lines with suspicious names
const ENV_VAR_LINE = /^\s*([A-Z0-9_]{4,})=(.+)$/gm;

export function containsPotentialSecrets(raw: string, parsedDocs: unknown[]): SecretDetectionResult | null {
  const reasons: string[] = [];
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // 1. Look for explicit Kubernetes Secret objects
  for (const doc of parsedDocs) {
    if (doc && typeof doc === 'object' && (doc as Record<string, unknown>)['kind'] === 'Secret') {
      reasons.push('Kubernetes Secret manifest detected (kind: Secret)');
      break;
    }
  }

  // 2. Look for common secret-like keys in any object recursively (limit depth)
  const scanObject = (obj: unknown, depth: number) => {
    if (depth > 6 || !obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      for (const v of obj) scanObject(v, depth + 1);
      return;
    }
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (SUSPICIOUS_KEY_PATTERNS.some(p => p.test(k))) {
        // If value is non-empty string or base64-ish
        if (typeof v === 'string' && v.trim().length > 0) {
          reasons.push(`Suspicious key name: ${k}`);
          if (v.length > 20) {
            reasons.push(`Value for key ${k} appears long (${v.length} chars)`);
          }
        } else if (typeof v === 'object') {
          // For Secret.data section (base64 values)
          if (k.toLowerCase() === 'data' || k.toLowerCase() === 'stringdata') {
            reasons.push(`Possible secret data block under key: ${k}`);
          }
        }
      }
      scanObject(v, depth + 1);
    }
  };
  for (const doc of parsedDocs) scanObject(doc, 0);

  // 3. Raw text pattern checks
  if (PRIVATE_KEY_BLOCK.test(raw)) {
    reasons.push('Private key block present');
  }

  // Environment variable style lines
  let match: RegExpExecArray | null;
  while ((match = ENV_VAR_LINE.exec(raw)) !== null) {
    const varName = match[1];
    if (SUSPICIOUS_KEY_PATTERNS.some(p => p.test(varName))) {
      reasons.push(`Suspicious environment variable: ${varName}`);
    }
  }

  // Generic long opaque strings (avoid counting YAML structure; simple heuristic)
  if (GENERIC_SECRET_LIKE.test(raw)) {
    // Only add generic reason if none more specific yet
    if (!reasons.some(r => r.includes('Private key') || r.includes('Secret') || r.includes('Suspicious'))) {
      reasons.push('Opaque secret-like token detected');
    }
  }

  return reasons.length > 0 ? { reasons } : null;
}
