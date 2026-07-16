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
      },
      fontFamily: {
        display: ['var(--font-display)', 'Copperplate', 'Georgia', 'serif'],
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 3px rgba(16,24,40,0.08), 0 1px 2px rgba(16,24,40,0.06)',
        'card-hover': '0 4px 12px rgba(16,24,40,0.12)',
      },
    },
  },
  plugins: [],
};

export default config;
