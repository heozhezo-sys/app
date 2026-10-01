/**
 * Component-layer tests.
 *
 * Run under the `jest-expo` preset with the React Native renderer. They verify the
 * accessibility contract the specification requires, which static type checking
 * cannot prove.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { StateView } from '@/components/Layout';
import { HabitRow } from '@/features/habits/components/HabitRow';
import { GoalRow } from '@/features/goals/components/GoalRow';
import { TaskRow } from '@/features/goals/components/TaskRow';
import { MilestoneRow } from '@/features/goals/components/MilestoneRow';
import { SetRow } from '@/features/fitness/components/SetRow';
import { ThemeProvider } from '@/theme/ThemeProvider';
import type { GoalSummary, Milestone, Task } from '@/types/goals';
import type { WorkoutSetWithExercise } from '@/types/fitness';
import type { HabitWithTodayState } from '@/types/habits';

const goal: GoalSummary = {
  id: 'g1',
  title: 'Run a 10k',
  description: null,
  category: 'fitness',
  colorIndex: 0,
  status: 'active',
  progressPct: 67,
  targetDate: '2026-06-01',
  startedAt: 0,
  completedAt: null,
  archivedAt: null,
  createdAt: 0,
  updatedAt: 0,
  totalMilestones: 3,
  completedMilestones: 2,
  totalTasks: 4,
  completedTasks: 1,
};

const task: Task = {
  id: 't1',
  title: 'Buy shoes',
  notes: null,
  goalId: 'g1',
  milestoneId: null,
  priority: 'high',
  status: 'todo',
  plannedDate: '2026-01-10',
  dueDate: null,
  completedAt: null,
  estimateMin: null,
  sortOrder: 0,
  recurringFromTaskId: null,
  createdAt: 0,
  updatedAt: 0,
};

const milestone: Milestone = {
  id: 'm1',
  goalId: 'g1',
  title: 'Buy shoes',
  status: 'pending',
  dueDate: '2026-02-01',
  completedAt: null,
  sortOrder: 0,
  createdAt: 0,
  updatedAt: 0,
};

// React Native Testing Library v14 made `render` asynchronous.
async function renderWithTheme(node: React.ReactElement, forced: 'light' | 'dark' = 'light') {
  return render(
    <ThemeProvider preference="system" forcedSystemScheme={forced}>
      {node}
    </ThemeProvider>,
  );
}

/** Flattens the style array React Native hands back so a token can be asserted. */
function flatStyle(node: { props: { style?: unknown } }): Record<string, unknown> {
  const style = node.props.style;
  if (Array.isArray(style)) {
    return style.filter(Boolean).reduce<Record<string, unknown>>((acc, entry) => {
      if (typeof entry === 'object' && entry !== null) Object.assign(acc, entry);
      return acc;
    }, {});
  }
  return (style as Record<string, unknown>) ?? {};
}

const habit: HabitWithTodayState = {
  id: 'h1',
  title: 'Read 20 minutes',
  description: null,
  icon: null,
  colorIndex: 0,
  cadence: 'daily',
  cadenceDays: [],
  targetPerPeriod: 1,
  reminderTime: null,
  sortOrder: 0,
  status: 'active',
  archivedAt: null,
  createdAt: 0,
  updatedAt: 0,
  completedToday: false,
  completedThisPeriod: 0,
  scheduledForDate: '2026-01-15',
};

describe('Button accessibility', () => {
  it('exposes the button role and label', async () => {
    const view = await renderWithTheme(<Button label="Create habit" onPress={() => undefined} />);
    expect(view.getByRole('button', { name: 'Create habit' })).toBeTruthy();
  });

  it('announces the disabled state', async () => {
    const view = await renderWithTheme(<Button label="Save" onPress={() => undefined} disabled />);
    expect(view.getByRole('button', { name: 'Save' }).props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });

  it('reports a busy state while loading', async () => {
    const view = await renderWithTheme(<Button label="Saving" onPress={() => undefined} loading />);
    expect(view.getByRole('button', { name: 'Saving' }).props.accessibilityState).toMatchObject({
      busy: true,
    });
  });

  it('keeps a 48pt minimum touch target', async () => {
    const view = await renderWithTheme(<Button label="Tap me" onPress={() => undefined} />);
    const style = flatStyle(view.getByRole('button', { name: 'Tap me' }));
    expect(style.minHeight).toBeGreaterThanOrEqual(48);
  });

  it('honours an assistive label that differs from the visible text', async () => {
    const view = await renderWithTheme(
      <Button label="." onPress={() => undefined} accessibilityLabel="Mark done" />,
    );
    expect(view.getByRole('button', { name: 'Mark done' })).toBeTruthy();
  });
});

describe('TextField accessibility', () => {
  it('labels the input and exposes the error as a hint', async () => {
    const view = await renderWithTheme(
      <TextField label="Title" value="" onChangeText={() => undefined} error="Required" />,
    );
    expect(view.getByLabelText('Title').props.accessibilityHint).toBe('Required');
  });
});

describe('StateView', () => {
  it('announces loading progress', async () => {
    const view = await renderWithTheme(<StateView state="loading" loadingLabel="Loading habits" />);
    expect(view.getByLabelText('Loading habits')).toBeTruthy();
  });

  it('offers a retry action on error instead of a dead end', async () => {
    const view = await renderWithTheme(
      <StateView state="error" errorMessage="Database busy" onRetry={() => undefined} />,
    );
    expect(view.getByText('Database busy')).toBeTruthy();
    expect(view.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('shows an explicit empty state', async () => {
    const view = await renderWithTheme(
      <StateView state="empty" emptyTitle="No habits yet" emptyBody="Create one" />,
    );
    expect(view.getByText('No habits yet')).toBeTruthy();
    expect(view.getByText('Create one')).toBeTruthy();
  });
});

describe('HabitRow accessibility', () => {
  it('exposes a checkbox whose state is not colour-only', async () => {
    const view = await renderWithTheme(<HabitRow habit={habit} onToggle={() => undefined} />);
    const row = view.getByRole('checkbox', { name: 'Read 20 minutes' });
    expect(row.props.accessibilityState).toMatchObject({ checked: false });
    expect(view.queryByTestId('habit-check-h1')).toBeNull();
  });

  it('announces a completed habit as checked and shows a non-colour indicator', async () => {
    const view = await renderWithTheme(
      <HabitRow habit={{ ...habit, completedToday: true }} onToggle={() => undefined} />,
    );
    const row = view.getByRole('checkbox', { name: 'Read 20 minutes' });
    expect(row.props.accessibilityState).toMatchObject({ checked: true });
    // The indicator is asserted by testID rather than by its glyph, so the check does
    // not depend on console encoding of a non-ASCII character.
    expect(view.getByTestId('habit-check-h1')).toBeTruthy();
  });

  it('gives the row an actionable accessibility hint', async () => {
    const view = await renderWithTheme(<HabitRow habit={habit} onToggle={() => undefined} />);
    const row = view.getByRole('checkbox', { name: 'Read 20 minutes' });
    expect(row.props.accessibilityHint).toBe('Double tap to mark done.');
  });

  it('fires the toggle when pressed', async () => {
    let toggled = 0;
    const view = await renderWithTheme(
      <HabitRow habit={habit} onToggle={() => (toggled += 1)} />,
    );
    await view.getByTestId('habit-toggle-h1').props.onClick?.();
    expect(toggled).toBe(1);
  });
});

describe('GoalRow accessibility', () => {
  it('exposes a single button target with a combined label', async () => {
    const view = await renderWithTheme(<GoalRow goal={goal} onPress={() => undefined} />);
    const row = view.getByRole('button', { name: 'Run a 10k' });
    expect(row.props.accessibilityHint).toContain('2 of 3 milestones');
    expect(row.props.accessibilityHint).toContain('1 of 4 tasks');
  });

  it('states progress as text rather than only as a bar', async () => {
    const view = await renderWithTheme(<GoalRow goal={goal} onPress={() => undefined} />);
    expect(view.getByText('67%')).toBeTruthy();
  });

  it('fires onPress when activated', async () => {
    let opened = 0;
    const view = await renderWithTheme(
      <GoalRow goal={goal} onPress={() => (opened += 1)} />,
    );
    await view.getByTestId('goal-g1').props.onClick?.();
    expect(opened).toBe(1);
  });
});

describe('TaskRow accessibility', () => {
  it('exposes a checkbox with the open state', async () => {
    const view = await renderWithTheme(
      <TaskRow task={task} onToggle={() => undefined} todayKey="2026-01-15" />,
    );
    const row = view.getByRole('checkbox', { name: 'Buy shoes' });
    expect(row.props.accessibilityState).toMatchObject({ checked: false });
    expect(row.props.accessibilityHint).toContain('High priority');
  });

  it('announces an overdue task in words, not by colour alone', async () => {
    const view = await renderWithTheme(
      <TaskRow task={task} onToggle={() => undefined} todayKey="2026-01-15" />,
    );
    // The task is planned for 2026-01-10, which is before the reference day.
    expect(view.getByText('Overdue')).toBeTruthy();
    expect(view.getByRole('checkbox', { name: 'Buy shoes' }).props.accessibilityHint).toContain(
      'Overdue',
    );
  });

  it('does not mark a future task overdue', async () => {
    const view = await renderWithTheme(
      <TaskRow
        task={{ ...task, plannedDate: '2026-01-20' }}
        onToggle={() => undefined}
        todayKey="2026-01-15"
      />,
    );
    expect(view.queryByText('Overdue')).toBeNull();
  });

  it('marks a completed task and clears the overdue warning', async () => {
    const view = await renderWithTheme(
      <TaskRow
        task={{ ...task, status: 'done', completedAt: 1 }}
        onToggle={() => undefined}
        todayKey="2026-01-15"
      />,
    );
    expect(view.getByRole('checkbox', { name: 'Buy shoes' }).props.accessibilityState).toMatchObject(
      { checked: true },
    );
    expect(view.queryByText('Overdue')).toBeNull();
    expect(view.getByTestId('task-check-t1')).toBeTruthy();
  });

  it('toggles when pressed', async () => {
    let toggled = 0;
    const view = await renderWithTheme(
      <TaskRow task={task} onToggle={() => (toggled += 1)} todayKey="2026-01-15" />,
    );
    await view.getByTestId('task-toggle-t1').props.onClick?.();
    expect(toggled).toBe(1);
  });
});

describe('MilestoneRow accessibility', () => {
  it('exposes an unchecked checkbox for a pending milestone', async () => {
    const view = await renderWithTheme(<MilestoneRow milestone={milestone} onToggle={() => undefined} />);
    expect(view.getByRole('checkbox', { name: 'Buy shoes' }).props.accessibilityState).toMatchObject(
      { checked: false },
    );
  });

  it('marks a completed milestone without relying on colour', async () => {
    const view = await renderWithTheme(
      <MilestoneRow milestone={{ ...milestone, status: 'completed' }} onToggle={() => undefined} />,
    );
    expect(view.getByRole('checkbox', { name: 'Buy shoes' }).props.accessibilityState).toMatchObject(
      { checked: true },
    );
    expect(view.getByTestId('milestone-check-m1')).toBeTruthy();
  });
});

describe('theme', () => {
  it('applies dark tokens when the system is dark', async () => {
    const view = await renderWithTheme(<AppText testID="t">Hello</AppText>, 'dark');
    expect(flatStyle(view.getByTestId('t')).color).toBe('#ECF1F7');
  });

  it('applies light tokens when the system is light', async () => {
    const view = await renderWithTheme(<AppText testID="t">Hello</AppText>, 'light');
    expect(flatStyle(view.getByTestId('t')).color).toBe('#111721');
  });
});
describe('SetRow accessibility', () => {
  const baseSet: WorkoutSetWithExercise = {
    id: 's1',
    workoutId: 'w1',
    exerciseId: 'ex-back-squat',
    setNumber: 1,
    setType: 'working',
    reps: 5,
    weightGrams: 60_000,
    durationSec: null,
    rpeScaled: null,
    isCompleted: true,
    createdAt: 0,
    updatedAt: 0,
    exerciseName: 'Back Squat',
    equipment: 'barbell',
  };

  it('reads the whole set as one label', async () => {
    const view = await renderWithTheme(<SetRow set={baseSet} weightUnit="kg" />);
    expect(view.getByLabelText('Back Squat, Set 1, 60 kg, 5 reps')).toBeTruthy();
  });

  it('states bodyweight in words rather than omitting the value', async () => {
    const view = await renderWithTheme(
      <SetRow set={{ ...baseSet, weightGrams: 0 }} weightUnit="kg" />,
    );
    // A zero must be read as "Bodyweight", not left as an ambiguous gap.
    expect(view.getByLabelText('Back Squat, Set 1, Bodyweight, 5 reps')).toBeTruthy();
  });

  it('includes RPE and set type when recorded', async () => {
    const view = await renderWithTheme(
      <SetRow set={{ ...baseSet, rpeScaled: 80, setType: 'warmup' }} weightUnit="kg" />,
    );
    expect(view.getByLabelText('Back Squat, Set 1, 60 kg, 5 reps, RPE 8, warmup')).toBeTruthy();
  });

  it('renders a timed set in seconds', async () => {
    const view = await renderWithTheme(
      <SetRow
        set={{
          ...baseSet,
          exerciseName: 'Plank',
          reps: null,
          weightGrams: null,
          durationSec: 90,
        }}
        weightUnit="kg"
      />,
    );
    expect(view.getByLabelText('Plank, Set 1, 1:30')).toBeTruthy();
  });
});

describe('Button selection state', () => {
  it('exposes a selected state to assistive tech', async () => {
    // A toggle whose state is shown only by its colour fails the accessibility rule, so
    // `selected` is forwarded rather than inferred from `variant`.
    const view = await renderWithTheme(
      <Button label="Favourites" onPress={() => undefined} selected />,
    );
    expect(view.getByRole('button').props.accessibilityState.selected).toBe(true);
  });

  it('exposes an unselected state rather than omitting it', async () => {
    const view = await renderWithTheme(
      <Button label="Favourites" onPress={() => undefined} selected={false} />,
    );
    expect(view.getByRole('button').props.accessibilityState.selected).toBe(false);
  });

  it('omits the state entirely for an ordinary button', async () => {
    const view = await renderWithTheme(<Button label="Save" onPress={() => undefined} />);
    expect(view.getByRole('button').props.accessibilityState.selected).toBeUndefined();
  });

  it('still reports busy alongside selected', async () => {
    const view = await renderWithTheme(
      <Button label="Save" onPress={() => undefined} selected loading />,
    );
    const state = view.getByRole('button').props.accessibilityState;
    expect(state.busy).toBe(true);
    expect(state.selected).toBe(true);
  });
});

