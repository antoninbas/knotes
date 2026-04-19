---
title: SQLite FTS5 Full-Text Search
created: 2024-01-13T09:00:00.000Z
modified: 2024-01-13T09:00:00.000Z
tags: ["sqlite", "fts5", "search"]
type: note
---

SQLite's FTS5 extension provides full-text search over text columns. It maintains an inverted index that maps each token to the set of rows containing it, enabling fast substring and phrase queries.

## Creating an FTS5 Table

```sql
CREATE VIRTUAL TABLE docs USING fts5(
  title,
  body,
  tokenize = 'porter unicode61'
);
```

The `tokenize` option selects the tokenizer. The porter tokenizer applies stemming (reducing words to their root form), while `unicode61` handles Unicode normalization and case folding. They are often combined.

## Tokenizers

- `unicode61` — splits on Unicode whitespace and punctuation; handles non-ASCII text.
- `porter` — English-language stemmer; "running" and "runs" map to the same token.
- `trigram` — creates trigram tokens, enabling substring (LIKE-style) queries.
- `ascii` — basic whitespace tokenizer, ASCII only.

## BM25 Ranking

FTS5 ranks results with BM25 (Best Matching 25), a probabilistic relevance model that accounts for term frequency within a document and inverse document frequency across the corpus. The `bm25()` auxiliary function returns a negative score (lower is better) for use in `ORDER BY`.

```sql
SELECT *, bm25(docs) AS score
FROM docs
WHERE docs MATCH 'fast search'
ORDER BY score;
```

BM25 considers document length normalization: long documents are not unfairly boosted by having more occurrences of a term.

## Phrase and Prefix Queries

FTS5 supports phrase queries `"exact phrase"`, prefix queries `word*`, and boolean operators `AND`, `OR`, `NOT`. The `NEAR` operator matches tokens within a specified distance of each other.

## Content Tables and External Content

FTS5 can be configured as a "content table" that mirrors another table, or as "contentless" to store only the index. Contentless FTS5 tables support search but not snippet extraction. External content tables avoid duplication but require a trigger to keep the index in sync.

## Snippet Extraction

The `snippet()` auxiliary function extracts a short excerpt from a document with matching terms highlighted:

```sql
SELECT snippet(docs, 1, '<b>', '</b>', '...', 10) FROM docs WHERE docs MATCH 'query';
```

This is useful for displaying search results with context around the matched terms.
