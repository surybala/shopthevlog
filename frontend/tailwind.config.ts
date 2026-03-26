import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#fafafa',
          100: '#f5f5f5',
          200: '#e5e5e5',
          300: '#d4d4d4',
          400: '#a3a3a3',
          500: '#ffffff',
          600: '#e5e5e5',
          700: '#d4d4d4',
          800: '#737373',
          900: '#171717',
        },
      },
      backgroundImage: {
        'gradient-hero':   'linear-gradient(135deg, #111214 0%, #1a1c1f 55%, #0f1012 100%)',
        'gradient-ocean':  'linear-gradient(160deg, #1a1a1a 0%, #2a2a2a 100%)',
        'gradient-sunset': 'linear-gradient(135deg, #e5e5e5 0%, #a3a3a3 100%)',
        'gradient-aurora': 'linear-gradient(135deg, #ffffff 0%, #d4d4d4 100%)',
        'gradient-card':   'linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03))',
        'shimmer':         'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0) 100%)',
      },
      backdropBlur: {
        xs:    '2px',
        glass: '12px',
        heavy: '24px',
      },
      boxShadow: {
        'glass':       '0 8px 32px 0 rgba(0,0,0,0.6)',
        'glass-sm':    '0 4px 16px 0 rgba(0,0,0,0.45)',
        'glass-lg':    '0 16px 48px 0 rgba(0,0,0,0.75)',
        'glow-white':  '0 0 20px rgba(255,255,255,0.40), 0 0 60px rgba(255,255,255,0.08)',
        'glow-indigo': '0 0 20px rgba(255,255,255,0.35)',
        'glow-blue':   '0 0 20px rgba(255,255,255,0.30)',
        'glow-pink':   '0 0 20px rgba(255,255,255,0.30)',
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
          '0%,100%': { boxShadow: '0 0 12px rgba(255,255,255,0.25)' },
          '50%':     { boxShadow: '0 0 28px rgba(255,255,255,0.55)' },
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
