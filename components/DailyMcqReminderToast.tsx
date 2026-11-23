'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  BellRing,
  Flame,
  ArrowRight,
  Clock,
  X,
  CheckCircle2,
  SlidersHorizontal,
  Bell,
  Sparkles,
} from 'lucide-react';
import { SchoolClass, UserProfile } from '@/lib/types';
import {
  DailyPracticeStatus,
  McqReminderSettings,
  MCQ_COMPLETED_EVENT,
  MCQ_REMINDER_SETTINGS_EVENT,
  MCQ_REMINDER_TEST_EVENT,
  dismissReminderForToday,
  formatReminderTimeLabel,
  getBrowserNotificationPermission,
  getDailyPracticeStatus,
  getLocalDateKey,
  getStudentStorageId,
  isBrowserNotificationSupported,
  isScheduledReminderDue,
  loadReminderDismissState,
  loadReminderSettings,
  markBrowserNotifSentToday,
  requestBrowserNotificationPermission,
  saveReminderSettings,
  sendBrowserMcqNotification,
  snoozeReminder,
} from '@/lib/mcqReminder';

interface DailyMcqReminderToastProps {
  user: UserProfile | null;
  selectedClass: SchoolClass;
  activeSection: string;
  language: 'hi' | 'en';
  onStartPractice: () => void;
  onOpenSettings: () => void;
}

type ToastMode = 'reminder' | 'celebration' | 'snoozed';

export function DailyMcqReminderToast({
  user,
  selectedClass,
  activeSection,
  language,
  onStartPractice,
  onOpenSettings,
}: DailyMcqReminderToastProps) {
  const studentId = getStudentStorageId(user);
  const [settings, setSettings] = useState<McqReminderSettings>(() => loadReminderSettings(studentId));
  const [status, setStatus] = useState<DailyPracticeStatus>(() =>
    getDailyPracticeStatus(studentId, selectedClass, settings.dailyGoalQuestions)
  );
  const [visible, setVisible] = useState(false);
  const [toastMode, setToastMode] = useState<ToastMode>('reminder');
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('unsupported');
  const [enablePushFeedback, setEnablePushFeedback] = useState<string | null>(null);
  const [celebrationScore, setCelebrationScore] = useState<string | null>(null);

  const initialDelayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isStudentRole = !user || user.role === 'student';

  const refreshState = useCallback(() => {
    const latestSettings = loadReminderSettings(studentId);
    setSettings(latestSettings);
    setStatus(getDailyPracticeStatus(studentId, selectedClass, latestSettings.dailyGoalQuestions));
    setPermission(getBrowserNotificationPermission());
  }, [studentId, selectedClass]);

  // Sync settings, permission & daily status on user/class change
  useEffect(() => {
    refreshState();
  }, [refreshState]);

  // Evaluate whether the daily reminder toast / browser notification should display
  const evaluateReminder = useCallback(
    (triggerReason: 'initial' | 'schedule' | 'test') => {
      const latestSettings = loadReminderSettings(studentId);
      const latestStatus = getDailyPracticeStatus(studentId, selectedClass, latestSettings.dailyGoalQuestions);
      setSettings(latestSettings);
      setStatus(latestStatus);

      if (triggerReason === 'test') {
        setToastMode('reminder');
        setVisible(true);
        if (latestSettings.browserPushEnabled && getBrowserNotificationPermission() === 'granted') {
          sendBrowserMcqNotification({
            selectedClass,
            language,
            suggestedSubject: latestStatus.suggestedSubject,
            currentStreak: latestStatus.currentStreak,
            dailyGoalQuestions: latestSettings.dailyGoalQuestions,
            onClick: onStartPractice,
          });
        }
        return;
      }

      if (!isStudentRole) return;
      if (!latestSettings.enabled) return;
      if (latestStatus.completedToday) return;
      if (activeSection === 'mcq') return;

      const dismissState = loadReminderDismissState(studentId);
      const todayKey = getLocalDateKey();

      if (dismissState.dismissedDate === todayKey) return;
      if (dismissState.snoozeUntil && Date.now() < dismissState.snoozeUntil) return;

      if (triggerReason === 'initial') {
        setToastMode('reminder');
        setVisible(true);
      }

      // Check if scheduled daily reminder time has arrived
      if (isScheduledReminderDue(latestSettings.reminderTime)) {
        setToastMode('reminder');
        setVisible(true);

        // Fire browser push notification once per day at/after scheduled time
        if (
          latestSettings.browserPushEnabled &&
          getBrowserNotificationPermission() === 'granted' &&
          dismissState.lastBrowserNotifDate !== todayKey
        ) {
          const sent = sendBrowserMcqNotification({
            selectedClass,
            language,
            suggestedSubject: latestStatus.suggestedSubject,
            currentStreak: latestStatus.currentStreak,
            dailyGoalQuestions: latestSettings.dailyGoalQuestions,
            onClick: onStartPractice,
          });
          if (sent) {
            markBrowserNotifSentToday(studentId);
          }
        }
      }
    },
    [studentId, selectedClass, isStudentRole, activeSection, language, onStartPractice]
  );

  // Trigger initial welcome reminder shortly after entering portal
  useEffect(() => {
    if (!user || !isStudentRole) return;

    if (initialDelayTimerRef.current) clearTimeout(initialDelayTimerRef.current);
    initialDelayTimerRef.current = setTimeout(() => {
      evaluateReminder('initial');
    }, 2400);

    // Periodic check every 60 seconds for scheduled time or snooze expiry
    const interval = setInterval(() => {
      evaluateReminder('schedule');
    }, 60 * 1000);

    return () => {
      if (initialDelayTimerRef.current) clearTimeout(initialDelayTimerRef.current);
      clearInterval(interval);
    };
  }, [user, isStudentRole, evaluateReminder]);

  // Hide reminder automatically when navigating into the MCQ Practice section
  useEffect(() => {
    if (activeSection === 'mcq' && visible && toastMode === 'reminder') {
      setVisible(false);
    }
  }, [activeSection, visible, toastMode]);

  // Listen for MCQ completion, settings changes, and test triggers
  useEffect(() => {
    const handleMcqCompleted = (event: Event) => {
      const customEvent = event as CustomEvent<{ score?: string; percentage?: number }>;
      const prevStatus = getDailyPracticeStatus(studentId, selectedClass, settings.dailyGoalQuestions);
      const updatedSettings = loadReminderSettings(studentId);
      const updatedStatus = getDailyPracticeStatus(studentId, selectedClass, updatedSettings.dailyGoalQuestions);
      setStatus(updatedStatus);

      // Show a celebratory toast when the student completes their daily practice session
      if (updatedStatus.sessionsToday === 1 || !prevStatus.completedToday) {
        setCelebrationScore(customEvent.detail?.score || null);
        setToastMode('celebration');
        setVisible(true);
        if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
        autoHideTimerRef.current = setTimeout(() => {
          setVisible(false);
        }, 6500);
      } else {
        setVisible(false);
      }
    };

    const handleSettingsUpdated = () => {
      const latestSettings = loadReminderSettings(studentId);
      setSettings(latestSettings);
      setPermission(getBrowserNotificationPermission());
      if (!latestSettings.enabled && toastMode === 'reminder') {
        setVisible(false);
      }
    };

    const handleTestTrigger = () => {
      evaluateReminder('test');
    };

    window.addEventListener(MCQ_COMPLETED_EVENT, handleMcqCompleted);
    window.addEventListener(MCQ_REMINDER_SETTINGS_EVENT, handleSettingsUpdated);
    window.addEventListener(MCQ_REMINDER_TEST_EVENT, handleTestTrigger);

    return () => {
      window.removeEventListener(MCQ_COMPLETED_EVENT, handleMcqCompleted);
      window.removeEventListener(MCQ_REMINDER_SETTINGS_EVENT, handleSettingsUpdated);
      window.removeEventListener(MCQ_REMINDER_TEST_EVENT, handleTestTrigger);
      if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
    };
  }, [studentId, selectedClass, settings.dailyGoalQuestions, toastMode, evaluateReminder]);

  const handleDismiss = () => {
    if (toastMode === 'reminder') {
      dismissReminderForToday(studentId);
    }
    setVisible(false);
  };

  const handleSnooze = () => {
    snoozeReminder(studentId, 30);
    setToastMode('snoozed');
    if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
    autoHideTimerRef.current = setTimeout(() => {
      setVisible(false);
    }, 2600);
  };

  const handleStartNow = () => {
    setVisible(false);
    onStartPractice();
  };

  const handleEnableBrowserPush = async () => {
    const result = await requestBrowserNotificationPermission();
    setPermission(result);
    if (result === 'granted') {
      const updated: McqReminderSettings = { ...settings, enabled: true, browserPushEnabled: true };
      saveReminderSettings(studentId, updated);
      setSettings(updated);
      setEnablePushFeedback(
        language === 'hi'
          ? 'ब्राउज़र नोटिफिकेशन चालू हो गया!'
          : 'Browser alerts enabled!'
      );
      setTimeout(() => setEnablePushFeedback(null), 3000);
    } else if (result === 'denied') {
      setEnablePushFeedback(
        language === 'hi'
          ? 'ब्राउज़र में अनुमति ब्लॉक है — इन-ऐप रिमाइंडर जारी रहेगा।'
          : 'Blocked in browser — in-app toast reminders remain active.'
      );
      setTimeout(() => setEnablePushFeedback(null), 4000);
    }
  };

  const showBrowserOptIn =
    isBrowserNotificationSupported() && permission === 'default' && !settings.browserPushEnabled;

  return (
    <div
      className="fixed bottom-20 md:bottom-6 right-3 left-3 sm:left-auto sm:right-5 z-40 sm:w-[390px] pointer-events-none"
      aria-live="polite"
    >
      <AnimatePresence mode="wait">
        {visible && toastMode === 'reminder' && (
          <motion.div
            key="mcq-reminder-toast"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 360, damping: 28 }}
            className="pointer-events-auto bg-white rounded-2xl shadow-2xl border border-indigo-200/90 overflow-hidden"
          >
            {/* Top accent bar */}
            <div className="h-1.5 bg-gradient-to-r from-blue-700 via-indigo-600 to-amber-500" />

            <div className="p-4 space-y-3">
              {/* Header row */}
              <div className="flex items-start justify-between gap-2.5">
                <div className="flex items-start gap-2.5 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-700 to-indigo-800 text-white flex items-center justify-center shrink-0 shadow-sm">
                    <BellRing className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-700">
                        {language === 'hi' ? 'दैनिक MCQ रिमाइंडर' : 'Daily JAC MCQ Reminder'}
                      </span>
                      {status.currentStreak > 0 && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-[10px] font-bold text-amber-800">
                          <Flame className="w-3 h-3 text-amber-500" />
                          {status.currentStreak}d
                        </span>
                      )}
                    </div>
                    <h3 className="text-sm font-extrabold text-slate-900 leading-snug mt-0.5">
                      {language === 'hi'
                        ? `कक्षा ${selectedClass} — आज का अभ्यास बाकी है!`
                        : `Class ${selectedClass} Daily Practice Pending`}
                    </h3>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleDismiss}
                  aria-label="Dismiss daily reminder"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Message body */}
              <p className="text-xs text-slate-600 leading-relaxed">
                {language === 'hi'
                  ? `JAC बोर्ड परीक्षा की तैयारी के लिए आज ${status.suggestedSubject} के ${settings.dailyGoalQuestions} MCQ प्रश्न हल करें। निर्धारित समय: ${formatReminderTimeLabel(settings.reminderTime)}`
                  : `Stay sharp for JAC Board exams! Complete today's ${settings.dailyGoalQuestions}-question ${status.suggestedSubject} MCQ session. Scheduled: ${formatReminderTimeLabel(settings.reminderTime)}`}
              </p>

              {/* Optional Browser Push Opt-In Strip */}
              {showBrowserOptIn && (
                <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="flex items-center gap-2 min-w-0">
                    <Bell className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                    <span className="text-[11px] font-medium text-slate-700 truncate">
                      {language === 'hi' ? 'ब्राउज़र पुश अलर्ट भी चालू करें?' : 'Also get browser push alerts?'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleEnableBrowserPush}
                    className="px-2.5 py-1 rounded-lg bg-indigo-100 hover:bg-indigo-200 text-indigo-800 text-[11px] font-bold shrink-0 transition-colors cursor-pointer"
                  >
                    {language === 'hi' ? 'अनुमति दें' : 'Enable'}
                  </button>
                </div>
              )}

              {enablePushFeedback && (
                <p className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5">
                  {enablePushFeedback}
                </p>
              )}

              {/* Action Buttons */}
              <div className="flex items-center gap-2 pt-0.5">
                <button
                  type="button"
                  onClick={handleStartNow}
                  className="flex-1 py-2.5 px-3.5 rounded-xl bg-gradient-to-r from-blue-700 to-indigo-700 hover:from-blue-800 hover:to-indigo-800 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer"
                >
                  <span>{language === 'hi' ? 'अभ्यास शुरू करें' : 'Start MCQ Practice'}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onClick={handleSnooze}
                  className="py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                  title={language === 'hi' ? '30 मिनट बाद याद दिलाएं' : 'Remind me in 30 minutes'}
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>{language === 'hi' ? '30 मि.' : '30m'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setVisible(false);
                    onOpenSettings();
                  }}
                  className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors cursor-pointer"
                  title={language === 'hi' ? 'रिमाइंडर समय बदलें' : 'Reminder Settings'}
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {visible && toastMode === 'snoozed' && (
          <motion.div
            key="mcq-snoozed-toast"
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            className="pointer-events-auto bg-slate-900 text-white rounded-2xl px-4 py-3 shadow-xl border border-slate-700 flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-2.5">
              <Clock className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="text-xs font-semibold">
                {language === 'hi'
                  ? 'रिमाइंडर 30 मिनट के लिए टाला गया।'
                  : 'Reminder snoozed for 30 minutes.'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setVisible(false)}
              className="text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}

        {visible && toastMode === 'celebration' && (
          <motion.div
            key="mcq-celebration-toast"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 360, damping: 28 }}
            className="pointer-events-auto bg-emerald-950 text-white rounded-2xl p-4 shadow-2xl border border-emerald-700/80"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-5 h-5 text-emerald-300" />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                    <span className="text-xs font-extrabold text-emerald-200">
                      {language === 'hi' ? 'दैनिक लक्ष्य पूर्ण!' : 'Daily JAC Goal Completed!'}
                    </span>
                  </div>
                  <p className="text-xs text-emerald-100/90 leading-relaxed">
                    {language === 'hi'
                      ? `शाबाश! आज का MCQ अभ्यास पूरा हुआ${celebrationScore ? ` (${celebrationScore})` : ''}। वर्तमान स्ट्रीक: ${Math.max(1, status.currentStreak)} दिन।`
                      : `Great work! Daily MCQ practice logged${celebrationScore ? ` (${celebrationScore})` : ''}. Current streak: ${Math.max(1, status.currentStreak)} day(s).`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setVisible(false)}
                className="p-1 rounded-lg text-emerald-300/70 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
