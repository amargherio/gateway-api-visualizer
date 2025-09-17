// Secret / credential detection utility
// Heuristic scanning only; does not transmit data.

export interface SecretDetectionResult {
  reasons: string[]; // Each reason optionally prefixed with resource context
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

// Keys that reference a secret name rather than containing secret material; should not trigger on their own
const SECRET_REFERENCE_KEY_ALLOWLIST = new Set([
  'secretname', // secretName
  'secretref',
  'secretrefname',
  'cacertsecret',
  'tlssecret',
]);

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
  // Derive a parallel array of resource contexts for objects for quick lookup during recursion.
  // Context format: kind/name (or kind/unknown if name missing) for K8s-style objects.
  const docContexts: string[] = [];
  for (const d of parsedDocs) {
    if (d && typeof d === 'object') {
      const o = d as Record<string, any>;
      if (typeof o.kind === 'string') {
        const meta = o.metadata as Record<string, any> | undefined;
        const nm = meta && typeof meta.name === 'string' ? meta.name : 'unknown';
        docContexts.push(`${o.kind}/${nm}`);
      } else {
        docContexts.push('object');
      }
    } else {
      docContexts.push('');
    }
  }
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // 1. Look for explicit Kubernetes Secret objects
  parsedDocs.forEach((doc, idx) => {
    if (doc && typeof doc === 'object' && (doc as Record<string, unknown>)['kind'] === 'Secret') {
      reasons.push(`${docContexts[idx]}: Kubernetes Secret manifest detected (kind: Secret)`);
    }
  });

  // 2. Look for common secret-like keys in any object recursively (limit depth)
  const scanObject = (obj: unknown, depth: number, resourceCtx: string | null) => {
    if (depth > 6 || !obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      for (const v of obj) scanObject(v, depth + 1, resourceCtx);
      return;
    }
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const lowerK = k.toLowerCase();
      if (SUSPICIOUS_KEY_PATTERNS.some(p => p.test(k)) && !SECRET_REFERENCE_KEY_ALLOWLIST.has(lowerK)) {
        // If value is non-empty string or base64-ish
        if (typeof v === 'string' && v.trim().length > 0) {
          reasons.push(`${resourceCtx || 'object'}: Suspicious key name: ${k}`);
          if (v.length > 20) {
            reasons.push(`${resourceCtx || 'object'}: Value for key ${k} appears long (${v.length} chars)`);
          }
        } else if (typeof v === 'object') {
          // For Secret.data section (base64 values)
          if (lowerK === 'data' || lowerK === 'stringdata') {
            reasons.push(`${resourceCtx || 'object'}: Possible secret data block under key: ${k}`);
          }
        }
      }
      // If this nested object itself is a k8s object, update context
      let nextCtx = resourceCtx;
      if (v && typeof v === 'object') {
        const vv = v as Record<string, any>;
        if (typeof vv.kind === 'string') {
          const meta = vv.metadata as Record<string, any> | undefined;
          const nm = meta && typeof meta.name === 'string' ? meta.name : 'unknown';
          nextCtx = `${vv.kind}/${nm}`;
        }
      }
      scanObject(v, depth + 1, nextCtx);
    }
  };
  parsedDocs.forEach((doc, idx) => {
    scanObject(doc, 0, docContexts[idx] || null);
  });

  // 3. Raw text pattern checks
  if (PRIVATE_KEY_BLOCK.test(raw)) {
    reasons.push(`raw: Private key block present`);
  }

  // Environment variable style lines
  let match: RegExpExecArray | null;
  while ((match = ENV_VAR_LINE.exec(raw)) !== null) {
    const varName = match[1];
    if (SUSPICIOUS_KEY_PATTERNS.some(p => p.test(varName))) {
      reasons.push(`raw: Suspicious environment variable: ${varName}`);
    }
  }

  // Generic long opaque strings (avoid counting YAML structure; simple heuristic)
  if (GENERIC_SECRET_LIKE.test(raw)) {
    // Only add generic reason if none more specific yet
    if (!reasons.some(r => r.includes('Private key') || r.includes('Secret') || r.includes('Suspicious'))) {
      reasons.push('raw: Opaque secret-like token detected');
    }
  }

  return reasons.length > 0 ? { reasons } : null;
}
