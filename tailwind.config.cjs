// Colours are CSS variables. A plain utility uses the variable as is; an opacity
// modifier (bg-primary/10) mixes it with transparent. Without this, Tailwind 3
// silently drops every modifier on a var() colour.
const token = (name) => ({ opacityValue }) =>
    opacityValue === undefined || String(opacityValue).startsWith('var(')
        ? `var(--${name})`
        : `color-mix(in srgb, var(--${name}) ${Number(opacityValue) * 100}%, transparent)`;

/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        "./src/**/*.{html,tsx,ts}",
        "./src/components/ui/**/*.{tsx,ts}",
        "./node_modules/@assistant-ui/react-ui/dist/**/*.{js,mjs}"
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
    				tiny: [
    					'var(--text-tiny)',
    					{
    						lineHeight: 'var(--leading-normal)'
    					}
    				],
    				micro: [
    					'var(--text-micro)',
    					{
    						lineHeight: 'var(--leading-normal)'
    					}
    				],
    				caption: [
    					'var(--text-caption)',
    					{
    						lineHeight: 'var(--leading-normal)'
    					}
    				],
    				xs: [
    					'var(--text-xs)',
    					{
    						lineHeight: 'var(--leading-normal)'
    					}
    				],
    				label: [
    					'var(--text-label)',
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
    				],
    				'2xl': [
    					'var(--text-2xl)',
    					{
    						lineHeight: 'var(--leading-tight)'
    					}
    				],
    				'3xl': [
    					'var(--text-3xl)',
    					{
    						lineHeight: 'var(--leading-tight)'
    					}
    				],
    				'4xl': [
    					'var(--text-4xl)',
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
    			'bg-0': token('bg-0'),
    			'bg-1': token('bg-1'),
    			'bg-2': token('bg-2'),
    			text: token('text'),
    			'text-strong': token('text-strong'),
    			'text-default': token('text'),
    			'text-muted': token('text-muted'),
    			border: token('border'),
    			'border-subtle': token('border-subtle'),
    			'border-glass': token('border-glass'),
    			field: token('field'),
    			segment: token('segment'),
    			mark: { DEFAULT: token('mark'), foreground: token('mark-foreground') },
    			highlight: token('highlight'),
    			glass: {
    				bg: token('glass-bg'),
    			},
    			primary: {
    				DEFAULT: token('primary'),
    				hover: token('primary-hover'),
    				active: token('primary-active'),
    				foreground: token('primary-foreground'),
    				muted: token('primary-muted')
    			},
    			success: {
    				DEFAULT: token('success'),
    				muted: token('success-muted')
    			},
    			warning: {
    				DEFAULT: token('warning'),
    				muted: token('warning-muted')
    			},
    			danger: {
    				DEFAULT: token('danger'),
    				muted: token('danger-muted')
    			},
    			info: {
    				DEFAULT: token('info'),
    				muted: token('info-muted')
    			},
    			chart: token('chart-1'),
    			background: token('bg-0'),
    			foreground: token('text-strong'),
    			input: token('input'),
    			ring: token('ring'),
    			muted: {
    				DEFAULT: token('muted'),
    				foreground: token('text-muted')
    			},
    			card: {
    				DEFAULT: token('bg-1'),
    				foreground: token('text-strong')
    			},
    			popover: {
    				DEFAULT: token('bg-2'),
    				foreground: token('text-strong')
    			},
    			secondary: {
    				DEFAULT: token('bg-2'),
    				foreground: token('text-strong')
    			},
    			accent: {
    				DEFAULT: token('accent'),
    				foreground: token('text-strong')
    			},
    			destructive: {
    				DEFAULT: token('danger'),
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
    		// Filled and written colours differ: bg-primary is the fill, text-primary
    		// is the readable text tone of the same colour.
    		textColor: {
    			primary: { DEFAULT: token('primary-text'), foreground: token('primary-foreground') },
    			success: token('success-text'),
    			warning: token('warning-text'),
    			danger: token('danger-text'),
    			destructive: { DEFAULT: token('danger-text'), foreground: 'white' },
    			info: token('info-text')
    		},
    		borderRadius: {
    			DEFAULT: 'var(--radius-xs)',
    			xs: 'var(--radius-xs)',
    			sm: 'var(--radius-sm)',
    			md: 'var(--radius-md)',
    			lg: 'var(--radius-lg)',
    			xl: 'var(--radius-xl)',
    			'2xl': 'var(--radius-2xl)',
    			full: 'var(--radius-full)',
    			input: 'var(--radius-input)'  // same shape as buttons
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
    			slow: '300ms',
    			panel: '400ms',
    			fade: '250ms'
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
    plugins: [
        require("tailwindcss-animate"),
        require("@assistant-ui/react-ui/tailwindcss").default(),
    ],
}
