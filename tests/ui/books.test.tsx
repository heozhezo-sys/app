/**
 * Accessibility contract for the book library row.
 *
 * The specification requires accessible touch targets, screen-reader support and
 * Dynamic Type. Static typing cannot prove any of that, so it is tested here.
 *
 * The central assertion is that a book is announced as ONE item. A row built from a
 * pressable title plus separate metadata text is read out as three unrelated fragments,
 * which is the most common way a list becomes unusable with VoiceOver or TalkBack.
 */

import { fireEvent, render } from '@testing-library/react-native';

import { BookRow } from '@/features/books/components/BookRow';
import { ThemeProvider } from '@/theme/ThemeProvider';
import type { BookWithProgress } from '@/repositories/booksRepository';
const book: BookWithProgress = {
  id: 'b1',
  title: 'Deep Work',
  author: 'Cal Newport',
  fileName: 'books/deep-work.pdf',
  originalName: 'deep-work.pdf',
  fileSizeBytes: 4096,
  pageCount: 250,
  currentPage: 100,
  progressPct: 40,
  status: 'reading',
  summary: null,
  addedAt: 0,
  lastReadAt: null,
  finishedAt: null,
  createdAt: 0,
  updatedAt: 0,
};

function row(overrides: Partial<BookWithProgress> = {}): BookWithProgress {
  return { ...book, ...overrides };
}

async function renderRow(overrides: Partial<BookWithProgress> = {}, onPress = () => {}) {
  return render(
    <ThemeProvider preference="system" forcedSystemScheme="light">
      <BookRow book={row(overrides)} onPress={onPress} />
    </ThemeProvider>,
  );
}

describe('BookRow', () => {
  it('announces the book as a single button', async () => {
    const { getByRole } = await renderRow();
    expect(getByRole('button')).toBeTruthy();
  });

  it('describes the book in one label, not scattered fragments', async () => {
    const { getByRole } = await renderRow();
    const label = getByRole('button').props.accessibilityLabel as string;

    // Title, author, length and progress all in one announcement.
    expect(label).toContain('Deep Work');
    expect(label).toContain('Cal Newport');
    expect(label).toContain('250 pages');
    expect(label).toContain('40% read');
  });

  it('hints at what activating it does', async () => {
    const { getByRole } = await renderRow();
    expect(getByRole('button').props.accessibilityHint).toBe('Opens the reader');
  });

  it('reports a finished book by status rather than a percentage', async () => {
    const { getByRole } = await renderRow({ status: 'finished', progressPct: 100 });
    expect(getByRole('button').props.accessibilityLabel).toContain('Finished');
  });

  it('omits the author when the document has none', async () => {
    const { getByRole, queryByText } = await renderRow({ author: null });
    // No empty gap where a subtitle would be.
    expect(queryByText('Cal Newport')).toBeNull();
    expect(getByRole('button').props.accessibilityLabel).not.toContain('Cal Newport');
  });

  it('invokes onPress when pressed', async () => {
    const onPress = jest.fn();
    const { getByRole } = await renderRow({}, onPress);

    // `Pressable` does not surface `onPress` on the host node, so the press is simulated
    // the way a user would perform it rather than by poking at props.
    fireEvent.press(getByRole('button'));
    expect(onPress).toHaveBeenCalledWith(expect.objectContaining({ id: 'b1' }));
  });

  it('lets text scale with the system font setting, within a sane bound', async () => {
    const { getByText } = await renderRow();
    const node = getByText('Deep Work');

    // Dynamic Type (iOS) and Android font scaling must work...
    expect(node.props.allowFontScaling).toBe(true);
    // ...but unbounded, an extreme system setting would break every layout on the screen.
    expect(node.props.maxFontSizeMultiplier).toBeLessThanOrEqual(2);
  });

  it('keeps the touch target at least 44pt tall', async () => {
    const { getByRole } = await renderRow();
    const style = getByRole('button').props.style;
    const flat = Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style;
    expect(flat.minHeight).toBeGreaterThanOrEqual(44);
  });
});

