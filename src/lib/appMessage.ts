export type AppMessageTone = 'info' | 'success' | 'warning' | 'error';

export type AppMessageDetail = {
  message: string;
  title?: string;
  tone?: AppMessageTone;
};

export const showAppMessage = (message: string, options: Omit<AppMessageDetail, 'message'> = {}) => {
  const value = String(message || '').trim();
  if (!value || typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<AppMessageDetail>('mboteroom:message', {
    detail: { message: value, title: options.title, tone: options.tone || 'info' },
  }));
};
