/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        "./src/**/*.{html,tsx,ts}",
        "./src/components/ui/**/*.{tsx,ts}"
    ],
    darkMode: ["class"],
    theme: {
    	screens: {
    		xs: '320px',
    		sm: '480px',
    		md: '768px',
    		lg: '1024px',
    		nav: '1210px',
    		xl: '1280px',
    		'2xl': '1920px'
    	},
    	extend: {
    		fontFamily: {
    			sans: [
    				'Inter',
    				'system-ui',
    				'-apple-system',
    				'sans-serif'
    			],
    			mono: [
    				'JetBrains Mono',
    				'Consolas',
    				'monospace'
    			]
    		},
    		fontSize: {
    			xs: [
    				'var(--text-xs)',
    				{
    					lineHeight: 'var(--leading-normal)'
    				}
    			],
    			sm: [
    				'var(--text-sm)',
    				{
    					lineHeight: 'var(--leading-normal)'
    				}
    			],
    			base: [
    				'var(--text-base)',
    				{
    					lineHeight: 'var(--leading-normal)'
    				}
    			],
    			lg: [
    				'var(--text-lg)',
    				{
    					lineHeight: 'var(--leading-tight)'
    				}
    			],
    			xl: [
    				'var(--text-xl)',
    				{
    					lineHeight: 'var(--leading-tight)'
    				}
    			]
    		},
    		spacing: {
    			'1': 'var(--space-1)',
    			'2': 'var(--space-2)',
    			'3': 'var(--space-3)',
    			'4': 'var(--space-4)',
    			'5': 'var(--space-5)',
    			'6': 'var(--space-6)',
    			'8': 'var(--space-8)',
    			'10': 'var(--space-10)',
    			'12': 'var(--space-12)',
    			'16': 'var(--space-16)',
    			'safe-top': 'env(safe-area-inset-top)',
    			'safe-bottom': 'env(safe-area-inset-bottom)',
    			'safe-left': 'env(safe-area-inset-left)',
    			'safe-right': 'env(safe-area-inset-right)'
    		},
    		colors: {
    			'bg-0': 'var(--bg-0)',
    			'bg-1': 'var(--bg-1)',
    			'bg-2': 'var(--bg-2)',
    			'text-strong': 'var(--text-strong)',
    			'text-default': 'var(--text)',
    			'text-muted': 'var(--text-muted)',
    			border: 'var(--border)',
    			'border-subtle': 'var(--border-subtle)',
    			highlight: 'var(--highlight)',
    			primary: {
    				DEFAULT: 'var(--primary)',
    				hover: 'var(--primary-hover)',
    				active: 'var(--primary-active)',
    				muted: 'var(--primary-muted)'
    			},
    			success: {
    				DEFAULT: 'var(--success)',
    				muted: 'var(--success-muted)'
    			},
    			warning: {
    				DEFAULT: 'var(--warning)',
    				muted: 'var(--warning-muted)'
    			},
    			danger: {
    				DEFAULT: 'var(--danger)',
    				muted: 'var(--danger-muted)'
    			},
    			info: {
    				DEFAULT: 'var(--info)',
    				muted: 'var(--info-muted)'
    			},
    			background: 'var(--bg-0)',
    			foreground: 'var(--text)',
    			input: 'var(--border)',
    			ring: 'var(--primary)',
    			muted: {
    				DEFAULT: 'var(--bg-1)',
    				foreground: 'var(--text-muted)'
    			},
    			card: {
    				DEFAULT: 'var(--bg-1)',
    				foreground: 'var(--text)'
    			},
    			popover: {
    				DEFAULT: 'var(--bg-2)',
    				foreground: 'var(--text)'
    			},
    			secondary: {
    				DEFAULT: 'var(--bg-2)',
    				foreground: 'var(--text)'
    			},
    			accent: {
    				DEFAULT: 'var(--bg-2)',
    				foreground: 'var(--text-strong)'
    			},
    			destructive: {
    				DEFAULT: 'var(--danger)',
    				foreground: 'white'
    			},
    			sidebar: {
    				DEFAULT: 'hsl(var(--sidebar-background))',
    				foreground: 'hsl(var(--sidebar-foreground))',
    				primary: 'hsl(var(--sidebar-primary))',
    				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
    				accent: 'hsl(var(--sidebar-accent))',
    				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
    				border: 'hsl(var(--sidebar-border))',
    				ring: 'hsl(var(--sidebar-ring))'
    			}
    		},
    		borderRadius: {
    			sm: 'var(--radius-sm)',
    			md: 'var(--radius-md)',
    			lg: 'var(--radius-lg)',
    			xl: 'var(--radius-xl)',
    			'2xl': 'var(--radius-2xl)',
    			full: 'var(--radius-full)'
    		},
    		boxShadow: {
    			sm: 'var(--shadow-sm)',
    			md: 'var(--shadow-md)',
    			lg: 'var(--shadow-lg)',
    			xl: 'var(--shadow-xl)',
    			inner: 'var(--shadow-inner)'
    		},
    		transitionDuration: {
    			fast: '150ms',
    			normal: '200ms',
    			slow: '300ms'
    		},
    		zIndex: {
    			dropdown: 'var(--z-dropdown)',
    			sticky: 'var(--z-sticky)',
    			'modal-backdrop': 'var(--z-modal-backdrop)',
    			modal: 'var(--z-modal)',
    			popover: 'var(--z-popover)',
    			tooltip: 'var(--z-tooltip)',
    			toast: 'var(--z-toast)'
    		}
    	}
    },
    plugins: [require("tailwindcss-animate")],
}

