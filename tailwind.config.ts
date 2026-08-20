import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Cornerstone brand palette
        brand: {
          green: '#98C73A',
          'green-dark': '#7BA82C',
          'green-light': '#B4DC6A',
          gray: '#777777',
          'gray-dark': '#4A4A4A',
          ink: '#1F2421',
        },
        // Semantic status colors (dashboard)
        status: {
          notstarted: '#777777',
          progress: '#F0A202',
          completed: '#98C73A',
        },
        // Neutral surfaces + hairlines. Tinted a hair toward the brand ink so
        // greys read as part of the palette instead of a separate cool grey.
        surface: {
          page: '#F4F6F4',
          sunken: '#EDF0ED',
          line: 'rgba(31,36,33,0.08)',
          'line-strong': 'rgba(31,36,33,0.16)',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        // Flat by default: cards separate from the page with a hairline, not a
        // drop shadow. Only genuinely floating layers (popovers, modals) lift.
        card: '0 1px 2px rgba(31,36,33,0.04)',
        'card-hover': '0 2px 8px -1px rgba(31,36,33,0.08), 0 1px 2px rgba(31,36,33,0.04)',
        pop: '0 12px 28px -8px rgba(31,36,33,0.18), 0 2px 6px rgba(31,36,33,0.06)',
        modal: '0 24px 56px -12px rgba(31,36,33,0.28), 0 4px 12px rgba(31,36,33,0.08)',
      },
      transitionTimingFunction: {
        // Strong custom curves — the built-in CSS easings are too weak to read
        // as intentional. Entering/exiting uses `out`, on-screen movement `in-out`.
        out: 'cubic-bezier(0.23, 1, 0.32, 1)',
        'in-out': 'cubic-bezier(0.77, 0, 0.175, 1)',
      },
    },
  },
  plugins: [],
};

export default config;
