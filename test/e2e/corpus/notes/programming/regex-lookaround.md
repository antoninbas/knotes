---
title: Regex Lookaround Assertions
created: 2024-01-14T09:00:00.000Z
modified: 2024-01-14T09:00:00.000Z
tags: ["regex", "lookahead", "lookbehind"]
type: note
---

Lookaround assertions are zero-width regex constructs that match a position in the string based on what precedes or follows, without consuming characters. They are useful when you need to assert context without including it in the match.

## Positive Lookahead `(?=...)`

Asserts that the pattern inside must match at this position, looking forward. The assertion succeeds if the engine can match the sub-pattern to the right, but the characters matched by the lookahead are not consumed.

```regex
\d+(?= dollars)
```

Matches a sequence of digits followed by " dollars", but the match itself is only the digits.

## Negative Lookahead `(?!...)`

Asserts that the pattern inside must NOT match at this position. Useful for excluding specific continuations.

```regex
foo(?!bar)
```

Matches "foo" not followed by "bar". "foobar" does not match; "foobaz" does.

## Positive Lookbehind `(?<=...)`

Asserts that the pattern inside must match immediately to the left of the current position. The characters matched by the lookbehind are not consumed.

```regex
(?<=\$)\d+
```

Matches digits preceded by a dollar sign. The `$` is not included in the match.

## Negative Lookbehind `(?<!...)`

Asserts that the pattern inside must NOT appear to the left.

```regex
(?<!un)happy
```

Matches "happy" not preceded by "un". "unhappy" does not match; "very happy" does.

## Variable-Length Lookbehinds

Most engines (PCRE, Python `re`, JavaScript via newer engines) require lookbehinds to have a fixed or bounded length. Python's `regex` module and .NET allow variable-length lookbehinds. JavaScript's `v` flag engine supports variable-length lookbehinds in modern environments.

## Combining Lookarounds

Lookarounds compose freely. To match a word that is both preceded by a digit and followed by a colon:

```regex
(?<=\d)\w+(?=:)
```

Lookarounds are evaluated at the same position, so complex conditions can be stacked.

## Performance Notes

Lookaheads are generally cheap. Lookbehinds scan backward from the current position, which can be slow if the lookbehind pattern is complex or applied inside a larger quantified group. Profile before using in hot paths.
