/**
 * Journal tags and search-query construction.
 *
 * The tag serialisation matters more than it looks: a delimiter-based format would let a
 * user type a comma in a tag and silently split it into two.
 */

import {
  MAX_TAGS,
  MAX_TAG_LENGTH,
  normaliseTags,
  parseTags,
  serialiseTags,
  sharedTags,
  splitTagString,
} from '@/journal/tags';
import { escapeLike, toMatchExpression } from '@/journal/search';

describe('tag normalisation', () => {
  it('trims and drops empties', () => {
    expect(normaliseTags(['  work  ', '', '   ', 'ideas'])).toEqual(['work', 'ideas']);
  });

  it('de-duplicates case-insensitively, keeping the first casing', () => {
    expect(normaliseTags(['Work', 'work', 'WORK'])).toEqual(['Work']);
  });

  it('preserves the order the user typed', () => {
    // Sorted order would lose "urgent" appearing before "work", which reads as a priority.
    expect(normaliseTags(['urgent', 'work'])).toEqual(['urgent', 'work']);
  });

  it('splits free text on commas, semicolons and newlines', () => {
    expect(normaliseTags('work, ideas; rest\nmore')).toEqual(['work', 'ideas', 'rest', 'more']);
  });

  it('keeps a comma that is inside a JSON-ish tag', () => {
    // JSON is the storage format precisely so delimiters in data survive a round trip.
    expect(parseTags(serialiseTags(['a,b']))).toEqual(['a,b']);
  });

  it('caps the tag count and length', () => {
    const many = Array.from({ length: MAX_TAGS + 10 }, (_, i) => `t${i}`);
    expect(normaliseTags(many)).toHaveLength(MAX_TAGS);

    expect(normaliseTags(['x'.repeat(200)])[0]).toHaveLength(MAX_TAG_LENGTH);
  });

  it('ignores non-string input', () => {
    expect(normaliseTags([1, 'ok', null, undefined] as never)).toEqual(['ok']);
  });
});

describe('tag serialisation', () => {
  it('round-trips a list exactly', () => {
    const tags = ['work', 'ideas', 'a,b', 'quote"inside'];
    expect(parseTags(serialiseTags(tags))).toEqual(tags);
  });

  it('stores no tags as null rather than an empty string', () => {
    // "No tags" should be SQL NULL, so it stays distinguishable from "".
    expect(serialiseTags([])).toBeNull();
    expect(serialiseTags('  ')).toBeNull();
    expect(serialiseTags(null)).toBeNull();
  });

  it('reads a null column as no tags', () => {
    expect(parseTags(null)).toEqual([]);
    expect(parseTags('')).toEqual([]);
    expect(parseTags('   ')).toEqual([]);
  });

  it('recovers from a malformed stored value rather than losing the entry', () => {
    // Losing access to the user's writing because a tag string is odd would be far worse
    // than losing the tags.
    expect(parseTags('not json at all')).toEqual(['not json at all']);
    expect(parseTags('{"not":"an array"}')).toEqual([]);
    expect(parseTags('[1, "ok", null]')).toEqual(['ok']);
  });

  it('reads a legacy comma-separated value', () => {
    expect(parseTags('work,ideas')).toEqual(['work', 'ideas']);
  });

  it('splits text into candidates', () => {
    expect(splitTagString('a,b;c')).toEqual(['a', 'b', 'c']);
    expect(splitTagString(null)).toEqual([]);
  });

  it('finds shared tags case-insensitively', () => {
    expect(sharedTags(['Work', 'rest'], ['work', 'health'])).toEqual(['work']);
    expect(sharedTags(['work'], ['health'])).toEqual([]);
  });
});

describe('search query construction', () => {
  it('escapes LIKE wildcards so they match literally', () => {
    // Without this, searching "50%" would match every entry.
    expect(escapeLike('50%')).toBe('50\\%');
    expect(escapeLike('a_b')).toBe('a\\_b');
    expect(escapeLike('back\\slash')).toBe('back\\\\slash');
  });

  it('quotes FTS5 terms so they are literals, not operators', () => {
    expect(toMatchExpression('deep work')).toBe('"deep" AND "work"');
  });

  it('doubles inner quotes per the FTS5 escaping rule', () => {
    expect(toMatchExpression('say "hi"')).toBe('"say" AND """hi"""');
  });

  it('neutralises FTS5 operator characters a user may type', () => {
    // A bare `*`, `:` or `-` would otherwise change the query's meaning or be a syntax error.
    const expression = toMatchExpression('a*b: c-d');
    expect(expression).not.toBeNull();
    // Every term is wrapped, so no operator sits outside quotes.
    expect(expression).toBe('"a*b:" AND "c-d"');
  });

  it('returns null for an empty or whitespace query', () => {
    expect(toMatchExpression('')).toBeNull();
    expect(toMatchExpression('   ')).toBeNull();
  });

  it('collapses repeated whitespace between terms', () => {
    expect(toMatchExpression('  deep   work  ')).toBe('"deep" AND "work"');
  });
});
