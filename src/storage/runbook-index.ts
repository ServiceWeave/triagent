import { readFile, writeFile, readdir, stat } from "fs/promises";
import { homedir } from "os";
import { join, extname, basename } from "path";
import type { RunbookEntry, RunbookIndex } from "./types.js";

const INDEX_FILE = join(homedir(), ".config", "triagent", "runbook-index.json");

export class RunbookIndexer {
  private index: RunbookIndex;
  private paths: string[];

  constructor(paths: string[] = []) {
    this.paths = paths;
    this.index = {
      entries: [],
      vocabulary: [],
      idfValues: {},
      lastIndexed: new Date(),
    };
  }

  async load(): Promise<void> {
    try {
      const content = await readFile(INDEX_FILE, "utf-8");
      this.index = JSON.parse(content, (key, value) => {
        if (key === "lastIndexed" || key === "lastModified") {
          return new Date(value);
        }
        return value;
      });
    } catch {
      // Index doesn't exist yet
    }
  }

  async save(): Promise<void> {
    await writeFile(INDEX_FILE, JSON.stringify(this.index, null, 2), "utf-8");
  }

  async indexPaths(paths: string[]): Promise<number> {
    this.paths = paths;
    const entries: RunbookEntry[] = [];

    for (const path of paths) {
      const files = await this.findMarkdownFiles(path);
      for (const file of files) {
        const entry = await this.parseRunbook(file);
        if (entry) {
          entries.push(entry);
        }
      }
    }

    // Build vocabulary and IDF values
    this.buildVocabulary(entries);

    // Compute TF-IDF vectors for each entry
    for (const entry of entries) {
      entry.tfidfVector = this.computeTfIdf(entry.content);
    }

    this.index = {
      entries,
      vocabulary: this.index.vocabulary,
      idfValues: this.index.idfValues,
      lastIndexed: new Date(),
    };

    await this.save();
    return entries.length;
  }

  private async findMarkdownFiles(dirPath: string): Promise<string[]> {
    const files: string[] = [];

    try {
      const entries = await readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);

        if (entry.isDirectory() && !entry.name.startsWith(".")) {
          const subFiles = await this.findMarkdownFiles(fullPath);
          files.push(...subFiles);
        } else if (entry.isFile() && [".md", ".markdown"].includes(extname(entry.name).toLowerCase())) {
          files.push(fullPath);
        }
      }
    } catch {
      // Directory not accessible
    }

    return files;
  }

  private async parseRunbook(filePath: string): Promise<RunbookEntry | null> {
    try {
      const content = await readFile(filePath, "utf-8");
      const fileStat = await stat(filePath);

      // Extract title from first heading or filename
      const titleMatch = content.match(/^#\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1] : basename(filePath, extname(filePath));

      // Extract tags from frontmatter or content
      const tags = this.extractTags(content);

      // Extract symptoms (lines that might describe problems)
      const symptoms = this.extractSymptoms(content);

      return {
        id: Buffer.from(filePath).toString("base64"),
        path: filePath,
        title,
        content,
        tags,
        symptoms,
        lastModified: fileStat.mtime,
      };
    } catch {
      return null;
    }
  }

  private extractTags(content: string): string[] {
    const tags: string[] = [];

    // Check for YAML frontmatter tags
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
      const tagsMatch = frontmatterMatch[1].match(/tags:\s*\[([^\]]+)\]/);
      if (tagsMatch) {
        tags.push(...tagsMatch[1].split(",").map((t) => t.trim().replace(/['"]/g, "")));
      }
    }

    // Extract keywords from headings
    const headings = content.match(/^#+\s+(.+)$/gm) || [];
    for (const heading of headings) {
      const text = heading.replace(/^#+\s+/, "").toLowerCase();
      if (text.includes("error") || text.includes("issue") || text.includes("problem")) {
        tags.push("troubleshooting");
      }
      if (text.includes("deploy") || text.includes("rollback")) {
        tags.push("deployment");
      }
      if (text.includes("scale") || text.includes("performance")) {
        tags.push("scaling");
      }
    }

    return [...new Set(tags)];
  }

  private extractSymptoms(content: string): string[] {
    const symptoms: string[] = [];

    // Look for sections that describe symptoms
    const lines = content.split("\n");
    let inSymptomsSection = false;

    for (const line of lines) {
      const lowerLine = line.toLowerCase();

      // Check if entering a symptoms section
      if (lowerLine.includes("symptom") || lowerLine.includes("sign") || lowerLine.includes("indicator")) {
        inSymptomsSection = true;
        continue;
      }

      // Check if leaving symptoms section
      if (inSymptomsSection && line.match(/^#+\s/)) {
        inSymptomsSection = false;
      }

      // Collect bullet points in symptoms section
      if (inSymptomsSection && line.match(/^[-*]\s/)) {
        symptoms.push(line.replace(/^[-*]\s+/, "").trim());
      }

      // Also look for error patterns
      if (lowerLine.includes("error:") || lowerLine.includes("exception:") || lowerLine.includes("failed:")) {
        symptoms.push(line.trim());
      }
    }

    return symptoms.slice(0, 10); // Limit to 10 symptoms
  }

  private buildVocabulary(entries: RunbookEntry[]): void {
    const docFrequency = new Map<string, number>();
    const vocabulary = new Set<string>();

    for (const entry of entries) {
      const words = this.tokenize(entry.content);
      const uniqueWords = new Set(words);

      for (const word of uniqueWords) {
        vocabulary.add(word);
        docFrequency.set(word, (docFrequency.get(word) || 0) + 1);
      }
    }

    this.index.vocabulary = Array.from(vocabulary);

    // Compute IDF values
    const numDocs = entries.length;
    for (const [word, df] of docFrequency) {
      this.index.idfValues[word] = Math.log((numDocs + 1) / (df + 1)) + 1;
    }
  }

  private computeTfIdf(content: string): Record<string, number> {
    const words = this.tokenize(content);
    const tf = new Map<string, number>();

    for (const word of words) {
      tf.set(word, (tf.get(word) || 0) + 1);
    }

    const vector: Record<string, number> = {};
    const maxTf = Math.max(...tf.values());

    for (const [word, count] of tf) {
      const normalizedTf = count / maxTf;
      const idf = this.index.idfValues[word] || 1;
      vector[word] = normalizedTf * idf;
    }

    return vector;
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !this.isStopWord(word));
  }

  private isStopWord(word: string): boolean {
    const stopWords = new Set([
      "the", "is", "at", "which", "on", "a", "an", "and", "or", "but",
      "in", "with", "to", "for", "of", "as", "by", "that", "this",
      "it", "from", "be", "are", "was", "were", "been", "being",
      "have", "has", "had", "do", "does", "did", "will", "would",
      "could", "should", "may", "might", "must", "can", "not", "no",
      "all", "any", "both", "each", "few", "more", "most", "other",
      "some", "such", "only", "own", "same", "than", "too", "very",
    ]);
    return stopWords.has(word);
  }

  search(query: string, limit: number = 5): RunbookEntry[] {
    const queryVector = this.computeTfIdf(query);
    const scores: Array<{ entry: RunbookEntry; score: number }> = [];

    for (const entry of this.index.entries) {
      if (!entry.tfidfVector) continue;

      const score = this.cosineSimilarity(queryVector, entry.tfidfVector);
      if (score > 0) {
        scores.push({ entry, score });
      }
    }

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score);

    return scores.slice(0, limit).map((s) => s.entry);
  }

  private cosineSimilarity(a: Record<string, number>, b: Record<string, number>): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (const key of Object.keys(a)) {
      const aVal = a[key] || 0;
      const bVal = b[key] || 0;
      dotProduct += aVal * bVal;
      normA += aVal * aVal;
    }

    for (const key of Object.keys(b)) {
      const bVal = b[key] || 0;
      normB += bVal * bVal;
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  searchBySymptoms(symptoms: string[], limit: number = 5): RunbookEntry[] {
    const query = symptoms.join(" ");
    return this.search(query, limit);
  }

  getByTags(tags: string[]): RunbookEntry[] {
    return this.index.entries.filter((entry) =>
      tags.some((tag) => entry.tags.includes(tag.toLowerCase()))
    );
  }

  getStats(): { totalRunbooks: number; lastIndexed: Date } {
    return {
      totalRunbooks: this.index.entries.length,
      lastIndexed: this.index.lastIndexed,
    };
  }
}

// Singleton instance
let runbookIndexer: RunbookIndexer | null = null;

export function getRunbookIndexer(): RunbookIndexer {
  if (!runbookIndexer) {
    runbookIndexer = new RunbookIndexer();
  }
  return runbookIndexer;
}

export async function initRunbookIndexer(paths?: string[]): Promise<RunbookIndexer> {
  const indexer = getRunbookIndexer();
  await indexer.load();
  if (paths && paths.length > 0) {
    await indexer.indexPaths(paths);
  }
  return indexer;
}
