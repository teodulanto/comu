from __future__ import annotations

import argparse
import csv
import json
import math
import re
import unicodedata
from collections import Counter
from pathlib import Path


PUNCTUATION = ".,;:¿?¡!"


def parse_references(path: Path) -> dict[str, str]:
    content = path.read_text(encoding="utf-8-sig")
    sections = re.findall(
        r"(?ms)^\*\*\*\s*(.+?)\s*\*\*\*\s*(.*?)(?=^\*\*\*|\Z)", content
    )
    return {name.strip(): body.strip() for name, body in sections}


def words(text: str, strip_accents: bool = False) -> list[str]:
    text = text.lower()
    if strip_accents:
        text = "".join(
            char
            for char in unicodedata.normalize("NFD", text)
            if unicodedata.category(char) != "Mn"
        )
    return re.findall(r"[^\W_]+", text, flags=re.UNICODE)


def edit_counts(reference: list[str], hypothesis: list[str]) -> tuple[int, int, int]:
    rows = len(reference) + 1
    cols = len(hypothesis) + 1
    distance = [[0] * cols for _ in range(rows)]
    operation = [[""] * cols for _ in range(rows)]

    for i in range(1, rows):
        distance[i][0] = i
        operation[i][0] = "delete"
    for j in range(1, cols):
        distance[0][j] = j
        operation[0][j] = "insert"

    priority = {"equal": 0, "substitute": 1, "delete": 2, "insert": 3}
    for i in range(1, rows):
        for j in range(1, cols):
            candidates = []
            if reference[i - 1] == hypothesis[j - 1]:
                candidates.append((distance[i - 1][j - 1], "equal"))
            else:
                candidates.append((distance[i - 1][j - 1] + 1, "substitute"))
            candidates.append((distance[i - 1][j] + 1, "delete"))
            candidates.append((distance[i][j - 1] + 1, "insert"))
            distance[i][j], operation[i][j] = min(
                candidates, key=lambda item: (item[0], priority[item[1]])
            )

    substitutions = deletions = insertions = 0
    i, j = len(reference), len(hypothesis)
    while i or j:
        current = operation[i][j]
        if current == "equal":
            i -= 1
            j -= 1
        elif current == "substitute":
            substitutions += 1
            i -= 1
            j -= 1
        elif current == "delete":
            deletions += 1
            i -= 1
        else:
            insertions += 1
            j -= 1
    return substitutions, deletions, insertions


def punctuation_score(reference: str, hypothesis: str) -> tuple[int, int, int]:
    expected = Counter(char for char in reference if char in PUNCTUATION)
    actual = Counter(char for char in hypothesis if char in PUNCTUATION)
    matched = sum(min(expected[char], actual[char]) for char in PUNCTUATION)
    return matched, sum(expected.values()), sum(actual.values())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus", type=Path, required=True)
    args = parser.parse_args()

    corpus = args.corpus.resolve()
    benchmark = corpus / ".benchmark"
    references = parse_references(corpus / "Transcripciones.md")
    timings = {
        (row["profile"], row["audio"]): float(row["elapsed_seconds"])
        for row in csv.DictReader((benchmark / "timings.csv").open(encoding="utf-8-sig"))
    }
    durations = {
        row["audio"]: float(row["duration_seconds"])
        for row in csv.DictReader((benchmark / "durations.csv").open(encoding="utf-8-sig"))
    }

    rows = []
    for transcript_path in sorted((benchmark / "runs").glob("*/*.txt")):
        profile = transcript_path.parent.name
        audio = transcript_path.stem
        if audio not in references:
            continue

        reference = references[audio]
        hypothesis = transcript_path.read_text(encoding="utf-8-sig", errors="replace").strip()
        reference_words = words(reference)
        hypothesis_words = words(hypothesis)
        substitutions, deletions, insertions = edit_counts(reference_words, hypothesis_words)
        relaxed = edit_counts(words(reference, True), words(hypothesis, True))
        punct_matched, punct_expected, punct_actual = punctuation_score(reference, hypothesis)

        rows.append(
            {
                "profile": profile,
                "audio": audio,
                "reference_words": len(reference_words),
                "hypothesis_words": len(hypothesis_words),
                "substitutions": substitutions,
                "deletions": deletions,
                "insertions": insertions,
                "wer": round((substitutions + deletions + insertions) / len(reference_words), 4),
                "relaxed_wer": round(sum(relaxed) / len(reference_words), 4),
                "word_coverage": round(len(hypothesis_words) / len(reference_words), 4),
                "punctuation_recall_proxy": round(punct_matched / punct_expected, 4) if punct_expected else 1.0,
                "punctuation_precision_proxy": round(punct_matched / punct_actual, 4) if punct_actual else 0.0,
                "elapsed_seconds": timings[(profile, audio)],
                "rtf": round(timings[(profile, audio)] / durations[audio], 4),
            }
        )

    fieldnames = list(rows[0])
    with (benchmark / "scores.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    summary = {}
    for profile in sorted({row["profile"] for row in rows}):
        selected = [row for row in rows if row["profile"] == profile]
        total_reference = sum(row["reference_words"] for row in selected)
        total_errors = sum(
            row["substitutions"] + row["deletions"] + row["insertions"] for row in selected
        )
        profile_timings = [
            (audio, elapsed)
            for (timing_profile, audio), elapsed in timings.items()
            if timing_profile == profile
        ]
        rtfs = sorted(elapsed / durations[audio] for audio, elapsed in profile_timings)
        p95_index = max(0, math.ceil(0.95 * len(rtfs)) - 1)
        summary[profile] = {
            "files": len(selected),
            "reference_words": total_reference,
            "micro_wer": round(total_errors / total_reference, 4),
            "mean_wer": round(sum(row["wer"] for row in selected) / len(selected), 4),
            "total_elapsed_seconds": round(sum(row["elapsed_seconds"] for row in selected), 3),
            "aggregate_rtf": round(
                sum(elapsed for _, elapsed in profile_timings)
                / sum(durations[audio] for audio, _ in profile_timings),
                4,
            ),
            "p95_rtf": round(rtfs[p95_index], 4),
        }

    (benchmark / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
