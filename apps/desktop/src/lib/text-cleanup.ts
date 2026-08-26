export function cleanTranscript(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;!?])/g, "$1")
    .trim();
}

export function applyPersonalVocabulary(value: string, vocabulary: string): string {
  const entries = vocabulary
    .split(/[,;\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [heard, replacement] = entry.split("=").map((part) => part.trim());
      if (!heard || !/^\p{L}[\p{L}\p{M}-]*$/u.test(heard)) {
        return null;
      }
      if (replacement && /^\p{L}[\p{L}\p{M}-]*$/u.test(replacement)) {
        return { heard: normalizeWord(heard), replacement, maximumDistance: 0 };
      }
      return { heard: normalizeWord(heard), replacement: heard, maximumDistance: 1 };
    })
    .filter((entry): entry is { heard: string; replacement: string; maximumDistance: number } => entry !== null);

  if (entries.length === 0) {
    return value;
  }

  return value.replace(/\p{L}[\p{L}\p{M}-]*/gu, (word) => {
    const normalizedWord = normalizeWord(word);
    let bestTerm = word;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const entry of entries) {
      if (Math.abs(normalizedWord.length - entry.heard.length) > entry.maximumDistance) {
        continue;
      }

      const distance = levenshteinDistance(normalizedWord, entry.heard);
      if (distance <= entry.maximumDistance && distance < bestDistance) {
        bestDistance = distance;
        bestTerm = /^[A-ZÁÉÍÓÚÜÑ]/u.test(word)
          ? entry.replacement.charAt(0).toUpperCase() + entry.replacement.slice(1)
          : entry.replacement;
      }
    }

    return bestTerm;
  });
}

function normalizeWord(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

function levenshteinDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        (current[rightIndex - 1] ?? Number.POSITIVE_INFINITY) + 1,
        (previous[rightIndex] ?? Number.POSITIVE_INFINITY) + 1,
        (previous[rightIndex - 1] ?? Number.POSITIVE_INFINITY) + substitutionCost
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length] ?? right.length;
}
