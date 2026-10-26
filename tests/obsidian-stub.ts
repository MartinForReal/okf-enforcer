// Node tests deliberately use JSON-flow frontmatter, a valid YAML subset.
// This is not a YAML implementation or a substitute for real Obsidian E2E.
export function parseYaml(text: string): unknown {
  return JSON.parse(text);
}
