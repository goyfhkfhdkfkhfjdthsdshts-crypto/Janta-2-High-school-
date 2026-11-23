import { SchoolClass, UserProfile } from '@/lib/types';

export interface McqReminderSettings {
  enabled: boolean;
  reminderTime: string; // HH:MM 24h format, e.g. "18:00"
  dailyGoalQuestions: number; // e.g. 10, 20, 30
  browserPushEnabled: boolean;
}

export interface DailyPracticeStatus {
  todayKey: string;
  completedToday: boolean;
  sessionsToday: number;
  questionsToday: number;
  goalQuestions: number;
  goalMet: boolean;
  currentStreak: number;
  lastPracticeDate: string | null;
  suggestedSubject: string;
}

export interface ReminderDismissState {
  dismissedDate: string | null;
  snoozeUntil: number | null; // epoch ms
  lastBrowserNotifDate: string | null;
}

export const DEFAULT_REMINDER_SETTINGS: McqReminderSettings = {
  enabled: true,
  reminderTime: '18:00',
  dailyGoalQuestions: 10,
  browserPushEnabled: false,
};

export const MCQ_COMPLETED_EVENT = 'janta_mcq_completed';
export const MCQ_REMINDER_SETTINGS_EVENT = 'janta_mcq_reminder_settings_updated';
export const MCQ_REMINDER_TEST_EVENT = 'janta_mcq_reminder_test';

const SUBJECTS_BY_CLASS: Record<SchoolClass, string[]> = {
  '9': ['Mathematics', 'Science', 'Social Science', 'Hindi', 'English'],
  '10': ['Mathematics', 'Science', 'Social Science', 'Hindi', 'English', 'Sanskrit'],
  '11': ['Physics', 'Chemistry', 'Mathematics', 'Biology', 'History', 'Economics'],
  '12': ['Physics', 'Chemistry', 'Mathematics', 'Biology', 'History', 'Economics'],
};

export function getStudentStorageId(user: UserProfile | null): string {
  return user?.studentId || user?.id || 'default_student';
}

export function getLocalDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getSettingsKey(studentId: string): string {
  return `janta_mcq_reminder_settings_${studentId}`;
}

function getStateKey(studentId: string): string {
  return `janta_mcq_reminder_state_${studentId}`;
}

export function loadReminderSettings(studentId: string): McqReminderSettings {
  if (typeof window === 'undefined') return DEFAULT_REMINDER_SETTINGS;
  try {
    const raw = localStorage.getItem(getSettingsKey(studentId));
    if (!raw) return DEFAULT_REMINDER_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_REMINDER_SETTINGS.enabled,
      reminderTime:
        typeof parsed.reminderTime === 'string' && /^\d{2}:\d{2}$/.test(parsed.reminderTime)
          ? parsed.reminderTime
          : DEFAULT_REMINDER_SETTINGS.reminderTime,
      dailyGoalQuestions:
        typeof parsed.dailyGoalQuestions === 'number' && parsed.dailyGoalQuestions >= 5
          ? parsed.dailyGoalQuestions
          : DEFAULT_REMINDER_SETTINGS.dailyGoalQuestions,
      browserPushEnabled:
        typeof parsed.browserPushEnabled === 'boolean'
          ? parsed.browserPushEnabled
          : DEFAULT_REMINDER_SETTINGS.browserPushEnabled,
    };
  } catch {
    return DEFAULT_REMINDER_SETTINGS;
  }
}

export function saveReminderSettings(studentId: string, settings: McqReminderSettings): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(getSettingsKey(studentId), JSON.stringify(settings));
    window.dispatchEvent(new CustomEvent(MCQ_REMINDER_SETTINGS_EVENT, { detail: { studentId, settings } }));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadReminderDismissState(studentId: string): ReminderDismissState {
  if (typeof window === 'undefined') {
    return { dismissedDate: null, snoozeUntil: null, lastBrowserNotifDate: null };
  }
  try {
    const raw = localStorage.getItem(getStateKey(studentId));
    if (!raw) {
      return { dismissedDate: null, snoozeUntil: null, lastBrowserNotifDate: null };
    }
    const parsed = JSON.parse(raw);
    return {
      dismissedDate: typeof parsed.dismissedDate === 'string' ? parsed.dismissedDate : null,
      snoozeUntil: typeof parsed.snoozeUntil === 'number' ? parsed.snoozeUntil : null,
      lastBrowserNotifDate: typeof parsed.lastBrowserNotifDate === 'string' ? parsed.lastBrowserNotifDate : null,
    };
  } catch {
    return { dismissedDate: null, snoozeUntil: null, lastBrowserNotifDate: null };
  }
}

export function saveReminderDismissState(studentId: string, state: ReminderDismissState): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(getStateKey(studentId), JSON.stringify(state));
  } catch {
    // Ignore storage errors
  }
}

export function dismissReminderForToday(studentId: string): void {
  const current = loadReminderDismissState(studentId);
  saveReminderDismissState(studentId, {
    ...current,
    dismissedDate: getLocalDateKey(),
    snoozeUntil: null,
  });
}

export function snoozeReminder(studentId: string, minutes: number = 30): number {
  const snoozeUntil = Date.now() + minutes * 60 * 1000;
  const current = loadReminderDismissState(studentId);
  saveReminderDismissState(studentId, {
    ...current,
    snoozeUntil,
  });
  return snoozeUntil;
}

export function markBrowserNotifSentToday(studentId: string): void {
  const current = loadReminderDismissState(studentId);
  saveReminderDismissState(studentId, {
    ...current,
    lastBrowserNotifDate: getLocalDateKey(),
  });
}

function normalizeAttemptDate(rawDate?: string): string | null {
  if (!rawDate) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) return rawDate;
  const parsed = new Date(rawDate);
  if (Number.isNaN(parsed.getTime())) return null;
  return getLocalDateKey(parsed);
}

export function getDailyPracticeStatus(
  studentId: string,
  selectedClass: SchoolClass = '10',
  goalQuestions: number = 10
): DailyPracticeStatus {
  const todayKey = getLocalDateKey();
  const utcTodayKey = new Date().toISOString().split('T')[0];
  const subjects = SUBJECTS_BY_CLASS[selectedClass] || SUBJECTS_BY_CLASS['10'];
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / (1000 * 60 * 60 * 24)
  );
  let suggestedSubject = subjects[dayOfYear % subjects.length];

  if (typeof window === 'undefined') {
    return {
      todayKey,
      completedToday: false,
      sessionsToday: 0,
      questionsToday: 0,
      goalQuestions,
      goalMet: false,
      currentStreak: 0,
      lastPracticeDate: null,
      suggestedSubject,
    };
  }

  try {
    const historyRaw = localStorage.getItem(`janta_test_history_${studentId}`);
    const attempts: Array<{
      date?: string;
      createdAt?: string;
      totalQuestions?: number;
      subject?: string;
    }> = historyRaw ? JSON.parse(historyRaw) : [];

    if (!Array.isArray(attempts) || attempts.length === 0) {
      return {
        todayKey,
        completedToday: false,
        sessionsToday: 0,
        questionsToday: 0,
        goalQuestions,
        goalMet: false,
        currentStreak: 0,
        lastPracticeDate: null,
        suggestedSubject,
      };
    }

    let sessionsToday = 0;
    let questionsToday = 0;
    const uniqueDates = new Set<string>();
    const recentSubjects = new Set<string>();

    attempts.forEach((attempt, idx) => {
      const dKey = normalizeAttemptDate(attempt.date || attempt.createdAt);
      if (dKey) {
        uniqueDates.add(dKey);
        if (dKey === todayKey || dKey === utcTodayKey) {
          sessionsToday += 1;
          questionsToday += Number(attempt.totalQuestions) || 10;
        }
      }
      if (idx < 3 && attempt.subject) {
        recentSubjects.add(attempt.subject);
      }
    });

    // Pick a subject the student hasn't practiced in their last 3 attempts
    const freshSubject = subjects.find((s) => !recentSubjects.has(s));
    if (freshSubject) {
      suggestedSubject = freshSubject;
    }

    // Calculate consecutive-day streak ending today or yesterday
    let currentStreak = 0;
    const cursor = new Date();
    const hasToday = uniqueDates.has(todayKey) || uniqueDates.has(utcTodayKey);

    if (!hasToday) {
      cursor.setDate(cursor.getDate() - 1);
    }

    for (let i = 0; i < 365; i++) {
      const checkLocal = getLocalDateKey(cursor);
      const checkUtc = cursor.toISOString().split('T')[0];
      if (uniqueDates.has(checkLocal) || uniqueDates.has(checkUtc)) {
        currentStreak += 1;
        cursor.setDate(cursor.getDate() - 1);
      } else {
        break;
      }
    }

    const sortedDates = Array.from(uniqueDates).sort().reverse();

    return {
      todayKey,
      completedToday: sessionsToday > 0,
      sessionsToday,
      questionsToday,
      goalQuestions,
      goalMet: questionsToday >= goalQuestions || sessionsToday > 0,
      currentStreak,
      lastPracticeDate: sortedDates[0] || null,
      suggestedSubject,
    };
  } catch {
    return {
      todayKey,
      completedToday: false,
      sessionsToday: 0,
      questionsToday: 0,
      goalQuestions,
      goalMet: false,
      currentStreak: 0,
      lastPracticeDate: null,
      suggestedSubject,
    };
  }
}

export function isScheduledReminderDue(reminderTime: string, now: Date = new Date()): boolean {
  const [hoursStr, minsStr] = reminderTime.split(':');
  const targetH = Number(hoursStr);
  const targetM = Number(minsStr);
  if (Number.isNaN(targetH) || Number.isNaN(targetM)) return false;

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const targetMinutes = targetH * 60 + targetM;
  return currentMinutes >= targetMinutes;
}

export function formatReminderTimeLabel(reminderTime: string): string {
  const [hStr, mStr] = reminderTime.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return reminderTime;
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

// Browser Push Notification Helpers (Safe for SSR & sandboxed iframes)
export function isBrowserNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getBrowserNotificationPermission(): NotificationPermission | 'unsupported' {
  if (!isBrowserNotificationSupported()) return 'unsupported';
  try {
    return window.Notification.permission;
  } catch {
    return 'unsupported';
  }
}

export async function requestBrowserNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!isBrowserNotificationSupported()) return 'unsupported';
  try {
    const permission = await window.Notification.requestPermission();
    return permission;
  } catch {
    return 'denied';
  }
}

export function sendBrowserMcqNotification(params: {
  selectedClass: SchoolClass;
  language: 'hi' | 'en';
  suggestedSubject: string;
  currentStreak: number;
  dailyGoalQuestions: number;
  onClick?: () => void;
}): boolean {
  if (!isBrowserNotificationSupported()) return false;
  if (getBrowserNotificationPermission() !== 'granted') return false;

  const { selectedClass, language, suggestedSubject, currentStreak, dailyGoalQuestions, onClick } = params;

  const title =
    language === 'hi'
      ? `दैनिक JAC कक्षा ${selectedClass} MCQ अभ्यास`
      : `Daily JAC Class ${selectedClass} MCQ Practice`;

  const body =
    language === 'hi'
      ? currentStreak > 0
        ? `आपकी ${currentStreak} दिन की स्ट्रीक जारी रखें! आज ${suggestedSubject} के ${dailyGoalQuestions} प्रश्नों का अभ्यास करें।`
        : `बोर्ड परीक्षा की तैयारी मजबूत करें! आज ${suggestedSubject} के ${dailyGoalQuestions} MCQ प्रश्न हल करें।`
      : currentStreak > 0
      ? `Keep your ${currentStreak}-day streak alive! Complete ${dailyGoalQuestions} ${suggestedSubject} MCQs today.`
      : `Stay exam-ready! Complete today's ${dailyGoalQuestions}-question ${suggestedSubject} MCQ session.`;

  try {
    const notification = new window.Notification(title, {
      body,
      tag: 'janta-daily-mcq-reminder',
      requireInteraction: false,
    });
    notification.onclick = () => {
      try {
        window.focus();
      } catch {}
      notification.close();
      if (onClick) onClick();
    };
    return true;
  } catch {
    return false;
  }
}
