import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#f0f4ff',
          100: '#e0eaff',
          200: '#c7d7fe',
          300: '#a5bcfd',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#1e1b4b',
        },
      },
      backgroundImage: {
        'gradient-hero':   'linear-gradient(135deg, #0f0c29, #302b63, #24243e)',
        'gradient-ocean':  'linear-gradient(160deg, #0093e9 0%, #80d0c7 100%)',
        'gradient-sunset': 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
        'gradient-aurora': 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
        'gradient-card':   'linear-gradient(135deg, rgba(255,255,255,0.12), rgba(255,255,255,0.04))',
        'shimmer':         'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0) 100%)',
      },
      backdropBlur: {
        xs:    '2px',
        glass: '12px',
        heavy: '24px',
      },
      boxShadow: {
        'glass':        '0 8px 32px 0 rgba(31, 38, 135, 0.37)',
        'glass-sm':     '0 4px 16px 0 rgba(31, 38, 135, 0.25)',
        'glass-lg':     '0 16px 48px 0 rgba(31, 38, 135, 0.45)',
        'glow-indigo':  '0 0 24px rgba(99, 102, 241, 0.5)',
        'glow-blue':    '0 0 24px rgba(59, 130, 246, 0.5)',
        'glow-pink':    '0 0 24px rgba(236, 72, 153, 0.5)',
      },
      zIndex: {
        '60': '60',
        '70': '70',
      },
      fontFamily: {
        sans:    ['Inter', 'system-ui', 'sans-serif'],
        display: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'shimmer':        'shimmer 2s infinite linear',
        'float':          'float 6s ease-in-out infinite',
        'pulse-glow':     'pulseGlow 2s ease-in-out infinite',
        'slide-in-right': 'slideInRight 0.3s ease-out',
        'slide-in-up':    'slideInUp 0.3s ease-out',
        'fade-up':        'fadeUp 0.4s ease-out',
        'fade-in':        'fadeIn 0.3s ease-out',
        'spin-slow':      'spin 3s linear infinite',
      },
      keyframes: {
        shimmer: {
          '0%':   { backgroundPosition: '-200%' },
          '100%': { backgroundPosition: '200%' },
        },
        float: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%':     { transform: 'translateY(-10px)' },
        },
        pulseGlow: {
          '0%,100%': { boxShadow: '0 0 12px rgba(99,102,241,0.4)' },
          '50%':     { boxShadow: '0 0 28px rgba(99,102,241,0.8)' },
        },
        slideInRight: {
          from: { transform: 'translateX(100%)', opacity: '0' },
          to:   { transform: 'translateX(0)',    opacity: '1' },
        },
        slideInUp: {
          from: { transform: 'translateY(24px)', opacity: '0' },
          to:   { transform: 'translateY(0)',    opacity: '1' },
        },
        fadeUp: {
          from: { transform: 'translateY(16px)', opacity: '0' },
          to:   { transform: 'translateY(0)',    opacity: '1' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
  ],
}

export default config
