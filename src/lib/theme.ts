import { writable } from 'svelte/store';

type Theme = 'light' | 'dark';

const browser = typeof window !== 'undefined';

function createThemeStore() {
  // Try to get theme from localStorage or system preference
  const getInitialTheme = (): Theme => {
    if (browser) {
      const stored = localStorage.getItem('theme') as Theme;
      if (stored) return stored;
      
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light';
  };

  const { subscribe, set, update } = writable<Theme>(getInitialTheme());

  return {
    subscribe,
    toggle: () => update(theme => {
      const newTheme = theme === 'light' ? 'dark' : 'light';
      if (browser) {
        localStorage.setItem('theme', newTheme);
        document.documentElement.setAttribute('data-theme', newTheme);
      }
      return newTheme;
    }),
    set: (theme: Theme) => {
      if (browser) {
        localStorage.setItem('theme', theme);
        document.documentElement.setAttribute('data-theme', theme);
      }
      set(theme);
    }
  };
}

export const theme = createThemeStore();