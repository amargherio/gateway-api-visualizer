export interface YamlDocument {
  content: string;
  startLine: number;
}

function hasYamlContent(document: string): boolean {
  return document.split(/\r?\n/).some(line => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith('#');
  });
}

/**
 * Split a YAML stream while ignoring blank and comment-only documents.
 * js-yaml 5 throws for empty input, so callers should only load returned documents.
 */
export function splitYamlDocumentsWithLocations(content: string): YamlDocument[] {
  const rawDocuments = content.split(/^---\s*$/m);
  let searchFrom = 0;
  const documents: YamlDocument[] = [];

  for (const rawDocument of rawDocuments) {
    const rawStart = content.indexOf(rawDocument, searchFrom);
    searchFrom = rawStart + rawDocument.length;
    const trimmed = rawDocument.trim();
    if (!trimmed || !hasYamlContent(trimmed)) continue;

    const contentStart = rawStart + rawDocument.indexOf(trimmed);
    const startLine = content.slice(0, contentStart).split(/\r?\n/).length;
    documents.push({ content: trimmed, startLine });
  }

  return documents;
}

export function splitYamlDocuments(content: string): string[] {
  return splitYamlDocumentsWithLocations(content).map(document => document.content);
}
