/**
 * Goals, milestones and tasks end-to-end through service -> repository -> real SQLite.
 */

import { NodeSqliteDriver } from '../support/nodeSqliteDriver';
import {
  __resetDatabaseHandleForTests,
  __setDatabaseHandleForTests,
} from '@/database/database';
import { runMigrations } from '@/database/migrator';
import { LATEST_SCHEMA_VERSION } from '@/database/migrations/types';
import * as goals from '@/services/goalsService';
import { ValidationError } from '@/services/errors';
import { InvalidTransitionError } from '@/services/stateTransitions';

let driver: NodeSqliteDriver;

beforeEach(async () => {
  driver = new NodeSqliteDriver();
  await runMigrations(driver);
  __setDatabaseHandleForTests(driver, LATEST_SCHEMA_VERSION);
});

afterEach(async () => {
  __resetDatabaseHandleForTests();
  await driver.close();
});

async function makeGoal(title = 'Run a 10k') {
  return goals.createGoal({ title, targetDate: '2026-06-01' });
}

describe('creating goals', () => {
  it('persists a goal and reads it back', async () => {
    const goal = await makeGoal();

    expect(goal.id).toBeTruthy();
    expect(goal.title).toBe('Run a 10k');
    expect(goal.status).toBe('active');
    expect(goal.progressPct).toBe(0);
    expect(goal.targetDate).toBe('2026-06-01');
    expect(goal.completedAt).toBeNull();

    const list = await goals.listGoals();
    expect(list.map((g) => g.id)).toContain(goal.id);
  });

  it('rejects an empty title', async () => {
    expect.assertions(2);
    try {
      await goals.createGoal({ title: '   ' });
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).fields.title).toBe('Required');
    }
  });

  it('rejects an impossible target date', async () => {
    await expect(goals.createGoal({ title: 'X', targetDate: '2026-02-31' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(goals.createGoal({ title: 'X', targetDate: 'soon' })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe('goal status transitions', () => {
  it('follows the legal path active -> paused -> active', async () => {
    const goal = await makeGoal();

    await goals.setGoalStatus(goal.id, 'paused');
    expect((await goals.getGoal(goal.id))?.status).toBe('paused');

    await goals.setGoalStatus(goal.id, 'active');
    expect((await goals.getGoal(goal.id))?.status).toBe('active');
  });

  it('refuses to reopen a completed goal directly', async () => {
    const goal = await makeGoal();
    await goals.setGoalStatus(goal.id, 'completed');

    await expect(goals.setGoalStatus(goal.id, 'active')).rejects.toBeInstanceOf(
      InvalidTransitionError,
    );
    expect((await goals.getGoal(goal.id))?.status).toBe('completed');
  });

  it('stamps a completion time and forces progress to 100', async () => {
    const goal = await makeGoal();
    const done = await goals.setGoalStatus(goal.id, 'completed');

    expect(done?.completedAt).not.toBeNull();
    expect(done?.progressPct).toBe(100);
  });

  it('clears the completion time when a completed goal is archived then reopened', async () => {
    const goal = await makeGoal();
    await goals.setGoalStatus(goal.id, 'completed');

    await goals.setGoalStatus(goal.id, 'archived');
    const reopened = await goals.setGoalStatus(goal.id, 'active');

    expect(reopened?.status).toBe('active');
    expect(reopened?.completedAt).toBeNull();
    expect(reopened?.archivedAt).toBeNull();
  });

  it('hides archived goals from the default list but not the full list', async () => {
    const goal = await makeGoal();
    await goals.setGoalStatus(goal.id, 'archived');

    expect((await goals.listGoals()).map((g) => g.id)).not.toContain(goal.id);
    expect((await goals.listGoals(true)).map((g) => g.id)).toContain(goal.id);
  });

  it('reports a clear error for a goal that no longer exists', async () => {
    await expect(goals.setGoalStatus('missing', 'paused')).rejects.toBeInstanceOf(ValidationError);
  });
});
describe('milestones and derived progress', () => {
  it('derives progress from completed milestones', async () => {
    const goal = await makeGoal();
    await goals.createMilestone({ goalId: goal.id, title: 'Buy shoes' });
    await goals.createMilestone({ goalId: goal.id, title: 'Train 8 weeks' });
    await goals.createMilestone({ goalId: goal.id, title: 'Race day' });

    expect((await goals.getGoal(goal.id))?.progressPct).toBe(0);

    const milestones = await goals.listMilestones(goal.id);
    await goals.setMilestoneStatus(milestones[0]!.id, 'completed');
    expect((await goals.getGoal(goal.id))?.progressPct).toBe(33);

    await goals.setMilestoneStatus(milestones[1]!.id, 'completed');
    expect((await goals.getGoal(goal.id))?.progressPct).toBe(67);
  });

  it('reaches 100 when every milestone is complete', async () => {
    const goal = await makeGoal();
    for (const title of ['A', 'B', 'C']) {
      const milestone = await goals.createMilestone({ goalId: goal.id, title });
      await goals.setMilestoneStatus(milestone.id, 'completed');
    }
    expect((await goals.getGoal(goal.id))?.progressPct).toBe(100);
  });

  it('recomputes progress when a milestone is reopened', async () => {
    const goal = await makeGoal();
    const milestone = await goals.createMilestone({ goalId: goal.id, title: 'Only step' });

    await goals.setMilestoneStatus(milestone.id, 'completed');
    expect((await goals.getGoal(goal.id))?.progressPct).toBe(100);

    await goals.setMilestoneStatus(milestone.id, 'pending');
    expect((await goals.getGoal(goal.id))?.progressPct).toBe(0);
  });

  it('does not count a skipped milestone as progress', async () => {
    const goal = await makeGoal();
    const a = await goals.createMilestone({ goalId: goal.id, title: 'A' });
    const b = await goals.createMilestone({ goalId: goal.id, title: 'B' });

    await goals.setMilestoneStatus(a.id, 'completed');
    await goals.setMilestoneStatus(b.id, 'skipped');

    expect((await goals.getGoal(goal.id))?.progressPct).toBe(50);
  });

  it('refuses a manual progress value once milestones exist', async () => {
    const goal = await makeGoal();
    await goals.createMilestone({ goalId: goal.id, title: 'A' });

    await expect(goals.updateGoal(goal.id, { progressPct: 50 })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('accepts a manual progress value when there are no milestones', async () => {
    const goal = await makeGoal();
    const updated = await goals.updateGoal(goal.id, { progressPct: 40 });
    expect(updated?.progressPct).toBe(40);
  });

  it('rejects an out-of-range manual progress value', async () => {
    const goal = await makeGoal();
    await expect(goals.updateGoal(goal.id, { progressPct: 150 })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('reports milestone and task counts alongside a goal', async () => {
    const goal = await makeGoal();
    const milestone = await goals.createMilestone({ goalId: goal.id, title: 'A' });
    await goals.createTask({ title: 'Task one', goalId: goal.id });
    await goals.createTask({ title: 'Task two', goalId: goal.id, milestoneId: milestone.id });
    await goals.setMilestoneStatus(milestone.id, 'completed');

    const summary = (await goals.listGoals()).find((g) => g.id === goal.id);
    expect(summary?.totalMilestones).toBe(1);
    expect(summary?.completedMilestones).toBe(1);
    expect(summary?.totalTasks).toBe(2);
    expect(summary?.completedTasks).toBe(0);
  });

  it('keeps milestone history when a milestone is deleted', async () => {
    const goal = await makeGoal();
    const a = await goals.createMilestone({ goalId: goal.id, title: 'A' });
    const b = await goals.createMilestone({ goalId: goal.id, title: 'B' });
    await goals.setMilestoneStatus(a.id, 'completed');

    await goals.deleteMilestone(b.id);

    const remaining = await goals.listMilestones(goal.id);
    expect(remaining.map((m) => m.id)).toEqual([a.id]);
  });
});
describe('tasks', () => {
  it('creates a task attached to a goal', async () => {
    const goal = await makeGoal();
    const task = await goals.createTask({ title: 'Buy shoes', goalId: goal.id });

    expect(task.status).toBe('todo');
    expect(task.completedAt).toBeNull();
    expect(task.goalId).toBe(goal.id);
  });

  it('rejects a milestone belonging to a different goal', async () => {
    const first = await makeGoal('Goal one');
    const second = await makeGoal('Goal two');
    const foreign = await goals.createMilestone({ goalId: second.id, title: 'Elsewhere' });

    await expect(
      goals.createTask({ title: 'X', goalId: first.id, milestoneId: foreign.id }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('records a completion time when a task is finished', async () => {
    const task = await goals.createTask({ title: 'Read' });
    const done = await goals.toggleTask(task.id);

    expect(done.completed).toBe(true);
    const stored = await goals.getTask(task.id);
    expect(stored?.status).toBe('done');
    expect(stored?.completedAt).not.toBeNull();
  });

  it('clears the completion time when a task is reopened', async () => {
    const task = await goals.createTask({ title: 'Read' });
    await goals.toggleTask(task.id);
    const reopened = await goals.toggleTask(task.id);

    expect(reopened.completed).toBe(false);
    expect((await goals.getTask(task.id))?.completedAt).toBeNull();
  });

  it('refuses an illegal task transition', async () => {
    const task = await goals.createTask({ title: 'Read' });
    await goals.setTaskStatus(task.id, 'archived');

    await expect(goals.setTaskStatus(task.id, 'done')).rejects.toBeInstanceOf(
      InvalidTransitionError,
    );
  });

  it('refuses a negative estimate', async () => {
    await expect(goals.createTask({ title: 'X', estimateMin: -5 })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('orders by priority, then planned date', async () => {
    await goals.createTask({ title: 'low', priority: 'low', plannedDate: '2026-01-15' });
    await goals.createTask({ title: 'high', priority: 'high', plannedDate: '2026-01-15' });
    await goals.createTask({ title: 'medium', priority: 'medium', plannedDate: '2026-01-15' });

    const tasks = await goals.listTasks({ plannedDate: '2026-01-15' });
    expect(tasks.map((t) => t.title)).toEqual(['high', 'medium', 'low']);
  });

  it('separates open tasks from finished ones', async () => {
    const done = await goals.createTask({ title: 'done', plannedDate: '2026-01-15' });
    await goals.createTask({ title: 'open', plannedDate: '2026-01-15' });
    await goals.toggleTask(done.id);

    const open = await goals.listTasks({ plannedDate: '2026-01-15', statuses: ['todo'] });
    expect(open.map((t) => t.title)).toEqual(['open']);
  });

  it('surfaces overdue tasks alongside today, without duplicates', async () => {
    await goals.createTask({ title: 'overdue', plannedDate: '2026-01-10' });
    await goals.createTask({ title: 'today', plannedDate: '2026-01-15' });

    const titles = (await goals.tasksForDay('2026-01-15')).map((t) => t.title);

    expect(titles).toContain('overdue');
    expect(titles).toContain('today');
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('does not treat a finished task as overdue', async () => {
    const task = await goals.createTask({ title: 'old done', plannedDate: '2026-01-10' });
    await goals.toggleTask(task.id);

    const tasks = await goals.tasksForDay('2026-01-15');
    expect(tasks.map((t) => t.id)).not.toContain(task.id);
  });

  it('keeps task history after a soft delete', async () => {
    const task = await goals.createTask({ title: 'Deleted' });
    await goals.deleteTask(task.id);

    const rows = await driver.all('SELECT * FROM tasks WHERE id = ?;', [task.id]);
    expect(rows).toHaveLength(1);
    expect(await goals.listTasks({})).toHaveLength(0);
  });
});

describe('deleting a goal', () => {
  it('keeps the goal row and its milestones for history', async () => {
    const goal = await makeGoal();
    await goals.createMilestone({ goalId: goal.id, title: 'A' });

    await goals.deleteGoal(goal.id);

    expect(await goals.getGoal(goal.id)).toBeNull();
    const rows = await driver.all('SELECT * FROM goals WHERE id = ?;', [goal.id]);
    expect(rows).toHaveLength(1);
    expect(await goals.listGoals()).toHaveLength(0);
  });
});
